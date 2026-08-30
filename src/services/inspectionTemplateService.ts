/**
 * Inspection template management — create, edit, activate/deactivate.
 * Schema: organizations/{orgId}/inspectionTemplates/{templateId} -> InspectionTemplate
 *
 * Restricted to admin by firestore.rules (`allow write: if hasRole(orgId,
 * ['admin'])`) — already correct for everything in here, no rule change
 * needed. Testing this against a live org requires an actual admin
 * account; a fleet_manager account will get a permission-denied write.
 *
 * Templates are versioned. A completed Inspection's `templateId` +
 * `templateVersion` (see inspectionService.startInspection) have to keep
 * resolving to the exact content that was in effect when it ran, forever
 * — so `updateTemplate` never mutates the document being edited. It
 * creates a new document instead: `version` incremented, `familyId`
 * carried forward (groups every version of one lineage together),
 * `previousVersionId` pointing back at the version it supersedes. The
 * edited version's own document is left completely untouched — same id,
 * same content, same `isActive` — forever. It doesn't get archived,
 * flagged, or hidden; it just stops being "the latest version" of its
 * family (see `listLatestTemplates`), which is the only thing that
 * changes about it. A new version always starts `isActive: false`
 * regardless of what the edited version's `isActive` was — going live is
 * a separate, explicit action (`activateTemplate`), never an automatic
 * side effect of saving an edit.
 *
 * "Only one template per asset type active at a time" is enforced here,
 * not by a Firestore rule: `activateTemplate` deactivates whatever else
 * is active for the same `appliesTo` (any lineage, any version) in the
 * same batch. Every lookup in this file reads the full template
 * collection and filters client-side rather than using indexed where()
 * queries — an org has a handful of templates at most, and this keeps
 * "one active per asset type" a single source of truth (this file, not
 * also a composite index) without needing one.
 */
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";
import { db } from "../lib/firebase";
import { convertTimestamps, stripUndefined } from "../lib/firestoreUtils";
import type { AssetType, InspectionTemplate, TemplateItem } from "../types";

/** One checklist item as collected by the template form — used for both create and edit. */
export interface TemplateItemInput {
  /** Present when this row is an existing item being kept/renamed/reordered/toggled; omitted for a newly added row (a fresh id is generated). */
  id?: string;
  label: string;
  section?: string;
  requiresPhoto: boolean;
  requiresNote: boolean;
}

/** Fields the create form collects. */
export interface NewTemplateFields {
  name: string;
  description?: string;
  appliesTo: AssetType;
  recurrenceDays?: number;
  items: TemplateItemInput[];
}

/** Fields the edit form collects. `appliesTo` isn't editable — it's carried forward from the version being edited (see updateTemplate). */
export interface TemplateEditFields {
  name: string;
  description?: string;
  recurrenceDays?: number;
  items: TemplateItemInput[];
}

export interface UpdateTemplateResult {
  newTemplateId: string;
  newVersion: number;
}

function buildItems(templateId: string, inputs: TemplateItemInput[]): TemplateItem[] {
  return inputs.map((item, index) =>
    stripUndefined({
      id: item.id ?? uuidv4(),
      templateId,
      sortOrder: index,
      section: item.section?.trim() || undefined,
      label: item.label.trim(),
      // Not exposed by the template management UI (out of scope — see
      // task) — every item this UI creates is a plain pass/fail check
      // that must be answered, matching the only response type the
      // inspection form (inspections/new/page.tsx) actually renders.
      responseType: "pass_fail" as const,
      isRequired: true,
      requiresPhoto: item.requiresPhoto,
      requiresNote: item.requiresNote,
      // Matches the seeded template's items — a failed pass/fail item
      // becomes an Issue automatically (onInspectionComplete,
      // functions/src/index.ts).
      autoCreateIssueOnFail: true,
    })
  );
}

/**
 * Fetches a single InspectionTemplate version by its document id.
 * Returns `null` if no such document exists.
 */
export async function getTemplate(orgId: string, templateId: string): Promise<InspectionTemplate | null> {
  const snapshot = await getDoc(doc(db, "organizations", orgId, "inspectionTemplates", templateId));
  if (!snapshot.exists()) {
    return null;
  }
  return convertTimestamps<InspectionTemplate>({ id: snapshot.id, organizationId: orgId, ...snapshot.data() });
}

/**
 * Lists every template *version* in the org — every version of every
 * lineage, not just the current ones. Most callers want
 * `listLatestTemplates` or `getActiveTemplate` instead; this is the
 * shared read the rest of this file (and `listTemplateVersions`) filters
 * client-side.
 */
export async function listTemplates(orgId: string): Promise<InspectionTemplate[]> {
  const snapshot = await getDocs(collection(db, "organizations", orgId, "inspectionTemplates"));
  return snapshot.docs.map((d) =>
    convertTimestamps<InspectionTemplate>({ id: d.id, organizationId: orgId, ...d.data() })
  );
}

/**
 * One row per template lineage — the highest-`version` document in each
 * `familyId` group — for the template list page. A flat dump of
 * `listTemplates` would show every historical edit as its own row, which
 * isn't "the list of templates," it's the list's entire edit history.
 */
export async function listLatestTemplates(orgId: string): Promise<InspectionTemplate[]> {
  const all = await listTemplates(orgId);
  const latestByFamily = new Map<string, InspectionTemplate>();
  for (const template of all) {
    const current = latestByFamily.get(template.familyId);
    if (!current || template.version > current.version) {
      latestByFamily.set(template.familyId, template);
    }
  }
  return Array.from(latestByFamily.values());
}

/** Every version belonging to one lineage, newest first — for a template's version history on the edit page. */
export async function listTemplateVersions(orgId: string, familyId: string): Promise<InspectionTemplate[]> {
  const all = await listTemplates(orgId);
  return all.filter((template) => template.familyId === familyId).sort((a, b) => b.version - a.version);
}

/**
 * The template currently offered when starting a new inspection for a
 * given asset type (see inspections/new/page.tsx) — the one with
 * `isActive: true` for that `appliesTo`. Returns `null` if none is
 * active for that asset type.
 */
export async function getActiveTemplate(orgId: string, assetType: AssetType): Promise<InspectionTemplate | null> {
  const all = await listTemplates(orgId);
  return all.find((template) => template.appliesTo === assetType && template.isActive) ?? null;
}

/**
 * Creates a brand-new template lineage at version 1, `isActive: false`.
 * Activate it explicitly (`activateTemplate`) once it's ready to be
 * offered for real inspections.
 */
export async function createTemplate(orgId: string, fields: NewTemplateFields): Promise<string> {
  const name = fields.name.trim();
  if (!name) {
    throw new Error("Name is required.");
  }
  if (fields.items.length === 0) {
    throw new Error("At least one checklist item is required.");
  }

  const templateRef = doc(collection(db, "organizations", orgId, "inspectionTemplates"));
  const now = serverTimestamp();
  await setDoc(
    templateRef,
    stripUndefined({
      organizationId: orgId,
      name,
      description: fields.description?.trim() || undefined,
      appliesTo: fields.appliesTo,
      items: buildItems(templateRef.id, fields.items),
      recurrenceDays: fields.recurrenceDays,
      version: 1,
      familyId: templateRef.id,
      isActive: false,
      createdAt: now,
      updatedAt: now,
    })
  );

  return templateRef.id;
}

/**
 * Saves an edit as a new version of `templateId`'s lineage — see this
 * file's module comment for why it's never an in-place update. Refuses
 * to run if `templateId` isn't currently the latest version in its
 * family (i.e. someone already edited it since this form was loaded) —
 * editing a stale version would fork the lineage's version numbers
 * rather than advancing them.
 */
export async function updateTemplate(
  orgId: string,
  templateId: string,
  fields: TemplateEditFields
): Promise<UpdateTemplateResult> {
  const current = await getTemplate(orgId, templateId);
  if (!current) {
    throw new Error(`Template ${templateId} not found in organization ${orgId}`);
  }
  const name = fields.name.trim();
  if (!name) {
    throw new Error("Name is required.");
  }
  if (fields.items.length === 0) {
    throw new Error("At least one checklist item is required.");
  }

  const versions = await listTemplateVersions(orgId, current.familyId);
  const latestVersion = versions[0]?.version ?? current.version;
  if (current.version !== latestVersion) {
    throw new Error(
      `This is version ${current.version}, but version ${latestVersion} is now the latest — reload and edit that one instead.`
    );
  }

  const newRef = doc(collection(db, "organizations", orgId, "inspectionTemplates"));
  const now = serverTimestamp();
  const newVersion = current.version + 1;
  await setDoc(
    newRef,
    stripUndefined({
      organizationId: orgId,
      name,
      description: fields.description?.trim() || undefined,
      appliesTo: current.appliesTo,
      items: buildItems(newRef.id, fields.items),
      recurrenceDays: fields.recurrenceDays,
      version: newVersion,
      familyId: current.familyId,
      previousVersionId: current.id,
      isActive: false,
      createdAt: now,
      updatedAt: now,
    })
  );

  return { newTemplateId: newRef.id, newVersion };
}

/**
 * Activates a template version — makes it the one `getActiveTemplate`
 * returns for its asset type. Enforces "only one template per asset type
 * active at a time": every other currently-active template for the same
 * `appliesTo` (any lineage, any version) is deactivated in the same
 * batch.
 */
export async function activateTemplate(orgId: string, templateId: string): Promise<void> {
  const target = await getTemplate(orgId, templateId);
  if (!target) {
    throw new Error(`Template ${templateId} not found in organization ${orgId}`);
  }

  const all = await listTemplates(orgId);
  const others = all.filter(
    (template) => template.appliesTo === target.appliesTo && template.isActive && template.id !== target.id
  );

  const now = serverTimestamp();
  const batch = writeBatch(db);
  for (const other of others) {
    batch.update(doc(db, "organizations", orgId, "inspectionTemplates", other.id), {
      isActive: false,
      updatedAt: now,
    });
  }
  batch.update(doc(db, "organizations", orgId, "inspectionTemplates", target.id), {
    isActive: true,
    updatedAt: now,
  });
  await batch.commit();
}

/**
 * Deactivates a template version. Leaves its asset type with no active
 * template until something else is activated — a valid, explicit state
 * (see inspections/new/page.tsx's handling of `getActiveTemplate`
 * returning `null`), not an error.
 */
export async function deactivateTemplate(orgId: string, templateId: string): Promise<void> {
  await updateDoc(doc(db, "organizations", orgId, "inspectionTemplates", templateId), {
    isActive: false,
    updatedAt: serverTimestamp(),
  });
}
