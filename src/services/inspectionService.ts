/**
 * Inspection and defect-reporting workflow, backed by Firestore + Firebase
 * Storage. Schema:
 *   organizations/{orgId}/inspectionTemplates/{templateId}  -> InspectionTemplate
 *   organizations/{orgId}/inspections/{inspectionId}         -> Inspection
 *   organizations/{orgId}/issues/{issueId}                   -> Issue
 * Storage:
 *   organizations/{orgId}/inspections/{inspectionId}/photos/{photoId}
 *   organizations/{orgId}/defect-photos/{photoId}
 *
 * `Inspection.assetType` and `Issue.assetType` (see `src/types`) aren't
 * passed in by callers here — they're resolved server-side instead of
 * trusting the caller to supply them correctly:
 *   - startInspection resolves it from the template's `appliesTo`.
 *   - submitDefect resolves it by checking which collection (`vehicles`
 *     or `equipment`) `assetId` actually exists in.
 */
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { v4 as uuidv4 } from "uuid";
import { db, storage } from "../lib/firebase";
import { convertTimestamps, stripUndefined } from "../lib/firestoreUtils";
import type { AssetType, Inspection, InspectionItemResult, InspectionTemplate, Issue, IssueSeverity } from "../types";

/**
 * Shape of an inspection item response as supplied by the caller of
 * {@link completeInspection} — `id`/`inspectionId` are assigned here, and
 * `respondedAt` defaults to now if omitted.
 */
export type InspectionItemInput = Omit<InspectionItemResult, "id" | "inspectionId" | "respondedAt"> & {
  respondedAt?: string;
};

/**
 * Determines whether `assetId` refers to a Vehicle or a piece of Equipment
 * by checking which collection it actually exists in. Throws if it's in
 * neither.
 */
async function resolveAssetType(orgId: string, assetId: string): Promise<AssetType> {
  const vehicleSnap = await getDoc(doc(db, "organizations", orgId, "vehicles", assetId));
  if (vehicleSnap.exists()) {
    return "vehicle";
  }
  const equipmentSnap = await getDoc(doc(db, "organizations", orgId, "equipment", assetId));
  if (equipmentSnap.exists()) {
    return "equipment";
  }
  throw new Error(`Asset ${assetId} not found in organization ${orgId}`);
}

/**
 * Fetches an InspectionTemplate by ID from
 * `organizations/{orgId}/inspectionTemplates/{templateId}`. Returns `null`
 * if no such document exists.
 */
export async function getInspectionTemplate(
  orgId: string,
  templateId: string
): Promise<InspectionTemplate | null> {
  const snapshot = await getDoc(doc(db, "organizations", orgId, "inspectionTemplates", templateId));
  if (!snapshot.exists()) {
    return null;
  }
  return convertTimestamps<InspectionTemplate>({
    id: snapshot.id,
    organizationId: orgId,
    ...snapshot.data(),
  });
}

/**
 * Starts a new inspection: creates an `organizations/{orgId}/inspections`
 * document in progress (no items yet, not completed) and returns its ID.
 * The asset type is read from the template's `appliesTo` field rather
 * than trusted from the caller.
 */
export async function startInspection(
  orgId: string,
  assetId: string,
  templateId: string,
  inspectorId: string
): Promise<string> {
  const templateSnap = await getDoc(doc(db, "organizations", orgId, "inspectionTemplates", templateId));
  if (!templateSnap.exists()) {
    throw new Error(`Inspection template ${templateId} not found in organization ${orgId}`);
  }
  const assetType = templateSnap.data().appliesTo as AssetType;
  // Frozen at start, not looked up again later — templateId already
  // points at one immutable version's document (see
  // inspectionTemplateService), but templateVersion rides along for a
  // human-readable record without needing to dereference templateId.
  const templateVersion = templateSnap.data().version as number;

  const inspectionRef = doc(collection(db, "organizations", orgId, "inspections"));
  await setDoc(inspectionRef, {
    organizationId: orgId,
    templateId,
    templateVersion,
    assetType,
    assetId,
    inspectorUserId: inspectorId,
    items: [],
    issueIds: [],
    startedAt: serverTimestamp(),
  });

  return inspectionRef.id;
}

/**
 * Completes an in-progress inspection: fills in `id`/`inspectionId` (and
 * `respondedAt` where omitted) on each item, derives `overallResult` from
 * whether any item failed without an attached issue, collects
 * `issueIds` from the items, and sets `completedAt`.
 *
 * Every item, and the inspection update itself, is passed through
 * `stripUndefined` before being written — Firestore rejects `undefined`
 * field values outright (`setDoc`/`updateDoc` throw, including for
 * `undefined` inside array elements like `items`), and callers routinely
 * have optional fields (a note that wasn't required, a photo that wasn't
 * taken) resolve to `undefined` rather than an empty value.
 */
export async function completeInspection(
  orgId: string,
  inspectionId: string,
  items: InspectionItemInput[]
): Promise<void> {
  const now = new Date().toISOString();
  const fullItems: InspectionItemResult[] = items.map((item) =>
    stripUndefined({
      ...item,
      id: uuidv4(),
      inspectionId,
      // Always a string — an empty note is fine to store, `undefined` is not.
      textValue: item.textValue ?? "",
      // Omitted (via stripUndefined below) rather than written as `[]`
      // when no photo was actually uploaded.
      photoIds: item.photoIds && item.photoIds.length > 0 ? item.photoIds : undefined,
      respondedAt: item.respondedAt ?? now,
    })
  );

  const issueIds = Array.from(
    new Set(fullItems.map((item) => item.issueId).filter((id): id is string => Boolean(id)))
  );

  // Simple heuristic: a failed item with no issue logged against it fails
  // the whole inspection; failed items that already have an issue still
  // count as a pass with issues, rather than a hard fail.
  const hasUnresolvedFailure = fullItems.some((item) => item.passed === false && !item.issueId);
  const hasAnyFailure = fullItems.some((item) => item.passed === false);
  const overallResult: Inspection["overallResult"] = hasUnresolvedFailure
    ? "fail"
    : hasAnyFailure
      ? "pass_with_issues"
      : "pass";

  await updateDoc(
    doc(db, "organizations", orgId, "inspections", inspectionId),
    stripUndefined({
      items: fullItems,
      issueIds,
      overallResult,
      completedAt: serverTimestamp(),
    })
  );
}

/**
 * Uploads a photo to Firebase Storage at exactly `${storagePathPrefix}/{photoId}`
 * (no extension — Storage infers content-type from the File's own `.type`,
 * not the object name) and returns the generated `photoId`. Deliberately
 * NOT extension-suffixed: a `photoId` stored in Firestore has to be enough
 * on its own to reconstruct this exact path later (see
 * `getDefectPhotoUrl`) — an extension baked into the path would make that
 * impossible without guessing or listing the bucket. Shared by
 * `uploadInspectionPhoto` and `uploadDefectPhoto`, which differ only in
 * which folder they upload into.
 */
async function uploadPhoto(storagePathPrefix: string, file: File): Promise<string> {
  const photoId = uuidv4();
  const photoRef = ref(storage, `${storagePathPrefix}/${photoId}`);
  await uploadBytes(photoRef, file);
  return photoId;
}

/**
 * Uploads a photo for an inspection to Firebase Storage under
 * `organizations/{orgId}/inspections/{inspectionId}/photos/{photoId}`
 * and returns the generated `photoId`.
 */
export async function uploadInspectionPhoto(
  orgId: string,
  inspectionId: string,
  file: File
): Promise<string> {
  return uploadPhoto(`organizations/${orgId}/inspections/${inspectionId}/photos`, file);
}

/**
 * Uploads a photo for a standalone defect report (one not tied to any
 * inspection — e.g. an ad hoc issue reported from a vehicle's page) to
 * Firebase Storage under `organizations/{orgId}/defect-photos/{photoId}`
 * and returns the generated `photoId`. Use this instead of
 * `uploadInspectionPhoto` when there's no real `inspectionId` to scope
 * the upload under.
 */
export async function uploadDefectPhoto(orgId: string, file: File): Promise<string> {
  return uploadPhoto(`organizations/${orgId}/defect-photos`, file);
}

/**
 * Resolves a photoId previously returned by `uploadDefectPhoto` to a
 * downloadable URL, for displaying an Issue's photos (e.g. on the work
 * order detail page).
 */
export async function getDefectPhotoUrl(orgId: string, photoId: string): Promise<string> {
  return getDownloadURL(ref(storage, `organizations/${orgId}/defect-photos/${photoId}`));
}

/**
 * Fetches a single Issue by ID from `organizations/{orgId}/issues/{issueId}`.
 * Returns `null` if no such document exists.
 */
export async function getIssue(orgId: string, issueId: string): Promise<Issue | null> {
  const snapshot = await getDoc(doc(db, "organizations", orgId, "issues", issueId));
  if (!snapshot.exists()) {
    return null;
  }
  return convertTimestamps<Issue>({ id: snapshot.id, organizationId: orgId, ...snapshot.data() });
}

/**
 * Reports a defect against a vehicle or piece of equipment, creating an
 * `organizations/{orgId}/issues` document with `status: "open"` and
 * returns its ID. `photoIds` are IDs previously returned by
 * `uploadInspectionPhoto` — resolve them to display URLs (via
 * `getDownloadURL` against the same storage path) when rendering.
 */
export async function submitDefect(
  orgId: string,
  assetId: string,
  reporterId: string,
  title: string,
  description: string,
  severity: IssueSeverity,
  photoIds: string[]
): Promise<string> {
  const assetType = await resolveAssetType(orgId, assetId);

  const issueRef = doc(collection(db, "organizations", orgId, "issues"));
  await setDoc(issueRef, {
    organizationId: orgId,
    assetType,
    assetId,
    title,
    description,
    severity,
    status: "open",
    reportedByUserId: reporterId,
    photoIds,
    reportedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return issueRef.id;
}
