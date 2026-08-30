/**
 * Organization and org-scoped user profile data access, backed by
 * Firestore. Schema:
 *   organizations/{orgId}                    -> Organization
 *   organizations/{orgId}/users/{userId}      -> User
 *   userOrgs/{userId}                         -> { organizationId } lookup
 *
 * The top-level `userOrgs` collection exists because a signed-in Firebase
 * Auth user's org membership can't be derived from their UID alone (user
 * profiles live nested under their org) — it's a flat, UID-keyed pointer
 * consulted first to resolve which org to look the profile up in.
 */
import { collection, doc, getDoc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { convertTimestamps } from "../lib/firestoreUtils";
import type { Organization, User } from "../types";

/**
 * Fetches an Organization by ID from `organizations/{orgId}`.
 * Returns `null` if no such organization document exists.
 */
export async function getOrganization(orgId: string): Promise<Organization | null> {
  const snapshot = await getDoc(doc(db, "organizations", orgId));
  if (!snapshot.exists()) {
    return null;
  }
  return convertTimestamps<Organization>({ id: snapshot.id, ...snapshot.data() });
}

/** Fields the org settings form collects. */
export interface OrganizationEditFields {
  name: string;
  inspectionIntervalDays: number;
}

/**
 * Updates an organization's name and inspection interval — admin-only
 * per firestore.rules (`allow update: if hasRole(orgId, ['admin'])` on
 * `organizations/{orgId}`; a narrow addition made specifically for this,
 * see the rule's comment for why a direct rule rather than a Cloud
 * Function). A direct client write, unlike the `users` subcollection —
 * org settings carry no permission/role data, so there's no
 * privilege-escalation concern to route around via the Admin SDK.
 */
export async function updateOrganization(orgId: string, fields: OrganizationEditFields): Promise<void> {
  const name = fields.name.trim();
  if (!name) {
    throw new Error("Organization name is required.");
  }
  if (!Number.isFinite(fields.inspectionIntervalDays) || fields.inspectionIntervalDays <= 0) {
    throw new Error("Inspection interval must be a positive number of days.");
  }
  await updateDoc(doc(db, "organizations", orgId), {
    name,
    settings: { inspectionIntervalDays: fields.inspectionIntervalDays },
    updatedAt: serverTimestamp(),
  });
}

/**
 * Fetches a user's profile by ID from `organizations/{orgId}/users/{userId}`.
 * Returns `null` if no such user document exists within that organization.
 */
export async function getUserProfile(orgId: string, userId: string): Promise<User | null> {
  const snapshot = await getDoc(doc(db, "organizations", orgId, "users", userId));
  if (!snapshot.exists()) {
    return null;
  }
  return convertTimestamps<User>({ id: snapshot.id, organizationId: orgId, ...snapshot.data() });
}

/**
 * Lists every user profile in an organization. No filter or sort —
 * callers needing a lightweight name/roster (e.g. the work order
 * "Assigned To" autocomplete) do their own client-side handling. Plain
 * collection read, no index needed.
 */
export async function listUsers(orgId: string): Promise<User[]> {
  const snapshot = await getDocs(collection(db, "organizations", orgId, "users"));
  return snapshot.docs.map((d) => convertTimestamps<User>({ id: d.id, organizationId: orgId, ...d.data() }));
}

/**
 * Resolves which organization a signed-in user belongs to, via the
 * `userOrgs/{userId}` lookup doc. Returns `null` if no mapping exists
 * (e.g. a new Auth account whose org membership hasn't been provisioned
 * yet). Call this before `getUserProfile` when only the user's UID is
 * known (e.g. right after `onAuthStateChanged` fires).
 */
export async function getUserOrgId(userId: string): Promise<string | null> {
  const snapshot = await getDoc(doc(db, "userOrgs", userId));
  if (!snapshot.exists()) {
    return null;
  }
  const organizationId = snapshot.data().organizationId;
  return typeof organizationId === "string" ? organizationId : null;
}
