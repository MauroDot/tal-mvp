/**
 * Tactical Asset Log Cloud Functions.
 *
 * Written against the Cloud Functions 1st-gen ("v1") API — Firestore
 * onWrite/onCreate triggers and a Pub/Sub-backed scheduled function.
 *
 * Note on `admin.firestore()` / `admin.firestore.Timestamp`: that
 * namespaced compat API has been removed as of `firebase-admin` v14 (the
 * current major, installed here) — the root `firebase-admin` import now
 * exposes only app lifecycle functions, and every service (Firestore
 * included) is reached via its own modular subpath instead. This file
 * uses the current modular equivalents (`getFirestore`, `Timestamp`,
 * `FieldValue` from `firebase-admin/firestore`), which is functionally
 * the same code, just imported the way v14 actually requires.
 *
 * This is a standalone Node project (its own package.json/tsconfig), so
 * the shapes below are minimal local interfaces for the fields each
 * function actually touches, rather than imports from the web app's
 * `src/types` (a different TS project/build target — see the note in the
 * final summary if you want these unified into a shared package later).
 *
 * Firestore schema touched here (see also src/services/* in the web app):
 *   organizations/{orgId}
 *   organizations/{orgId}/vehicles/{vehicleId}
 *   organizations/{orgId}/equipment/{equipmentId}
 *   organizations/{orgId}/inspections/{inspectionId}
 *   organizations/{orgId}/inspectionTemplates/{templateId}
 *   organizations/{orgId}/issues/{issueId}
 *   organizations/{orgId}/workOrders/{workOrderId}
 *   organizations/{orgId}/alerts/{alertId}
 *   organizations/{orgId}/auditLogs/{auditLogId}
 *   organizations/{orgId}/counters/workOrders          -> { [year]: lastNumber }
 *
 * Vehicle status is never written directly by an individual trigger.
 * `onInspectionComplete`, `onIssueCreated`, and `onIssueUpdated` each call
 * the shared `recalculateVehicleStatus` helper after their own writes
 * commit — it re-reads the current facts (open issues, latest completed
 * inspection, current status) inside a transaction and derives one
 * answer, so two triggers touching the same vehicle can't race and
 * disagree. See the precedence rules on `deriveVehicleStatus` below.
 * Its `completedAt`-ordered inspections query needs a composite index
 * distinct from the existing `startedAt`-ordered one — see
 * firestore.indexes.json.
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, FieldValue, type Transaction } from "firebase-admin/firestore";
import * as functions from "firebase-functions/v1";
import * as logger from "firebase-functions/logger";

initializeApp();

const db = getFirestore();
const adminAuth = getAuth();

type AssetType = "vehicle" | "equipment";
type AssetStatus = "ready" | "attention" | "maintenance_required" | "out_of_service" | "retired" | "unknown";
type IssueSeverity = "low" | "medium" | "high" | "critical";
type IssueStatus = "open" | "acknowledged" | "in_progress" | "resolved" | "closed";
type WorkOrderPriority = "low" | "normal" | "high" | "urgent";

const OPEN_ISSUE_STATUSES: IssueStatus[] = ["open", "acknowledged", "in_progress"];
const RESOLVED_ISSUE_STATUSES: IssueStatus[] = ["resolved", "closed"];

/** Mirrors `InspectionItemResult` in the web app's `src/types`. */
interface InspectionItemResult {
  templateItemId: string;
  itemLabel: string;
  passed?: boolean;
  numericValue?: number;
  textValue?: string;
  issueId?: string;
}

/** Fields this file reads off an `organizations/{orgId}/inspections/{id}` document. */
interface InspectionDoc {
  templateId: string;
  assetType: AssetType;
  assetId: string;
  inspectorUserId: string;
  items: InspectionItemResult[];
  completedAt?: Timestamp;
}

/** Fields this file reads off an `organizations/{orgId}/issues/{id}` document. */
interface IssueDoc {
  assetType: AssetType;
  assetId: string;
  inspectionId?: string;
  title: string;
  description?: string;
  severity: IssueSeverity;
  status: IssueStatus;
  reportedByUserId: string;
}

/** Fields this file reads off an `organizations/{orgId}/vehicles/{id}` document. */
interface VehicleDoc {
  status?: AssetStatus;
}

/** Fields this file reads off an `organizations/{orgId}/equipment/{id}` document. */
interface EquipmentDoc {
  unitNumber: string;
  name: string;
  status: string;
  expirationDate?: Timestamp;
}

/**
 * Reserves the next sequential work order number for an org/year (e.g.
 * "WO-2026-0001") using a transaction on a per-org counter doc, so
 * concurrent issue creations never collide on the same number.
 */
async function getNextWorkOrderNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const counterRef = db.doc(`organizations/${orgId}/counters/workOrders`);

  const nextNumber = await db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(counterRef);
    const current = (snap.exists ? (snap.data()?.[year] as number | undefined) : undefined) ?? 0;
    const next = current + 1;
    tx.set(counterRef, { [year]: next }, { merge: true });
    return next;
  });

  return `WO-${year}-${String(nextNumber).padStart(4, "0")}`;
}

/** Maps an Issue's severity to a WorkOrder's scheduling priority. */
function severityToPriority(severity: IssueSeverity): WorkOrderPriority {
  switch (severity) {
    case "critical":
      return "urgent";
    case "high":
      return "high";
    case "low":
      return "low";
    case "medium":
    default:
      return "normal";
  }
}

/** Identifies what caused a `recalculateVehicleStatus` call, for the audit log. */
interface RecalculationTrigger {
  source: "onInspectionComplete" | "onIssueCreated" | "onIssueUpdated";
  entityId: string;
}

/** The facts `deriveVehicleStatus` decides from — nothing more. */
interface VehicleStatusFacts {
  currentStatus: AssetStatus;
  /** Severities of issues currently open (not resolved/closed) against this vehicle. */
  openIssueSeverities: IssueSeverity[];
  /** `overallResult` of the most recent *completed* inspection, if any has ever completed. */
  latestCompletedResult?: "pass" | "fail" | "pass_with_issues";
}

/**
 * Derives a vehicle's status from the current facts. Precedence, first
 * match wins:
 *   1. Current status is "out_of_service" or "retired" -> keep it. These
 *      are manual, human-set states; no automatic fact should override
 *      them.
 *   2. Most recent completed inspection result is "fail" -> "maintenance_required".
 *      A raw failed checklist item means unfit for use, independent of
 *      whether an Issue has been logged for it yet.
 *   3. Any open issue with severity "critical" or "high" -> "maintenance_required".
 *      This is checked before "ready" can ever be reached, so a passing
 *      inspection can NOT clear maintenance_required while a
 *      critical/high issue is still open.
 *   4. Any open issue with severity "low" or "medium" -> "attention".
 *   5. A completed inspection exists (pass or pass_with_issues) and no
 *      open issues remain -> "ready".
 *   6. No completed inspection has ever existed, and no open issues
 *      exist -> "unknown" (no signal to derive a status from at all).
 */
function deriveVehicleStatus(facts: VehicleStatusFacts): { status: AssetStatus; rule: string } {
  if (facts.currentStatus === "out_of_service" || facts.currentStatus === "retired") {
    return { status: facts.currentStatus, rule: "manual_override_preserved" };
  }
  if (facts.latestCompletedResult === "fail") {
    return { status: "maintenance_required", rule: "latest_inspection_failed" };
  }
  if (facts.openIssueSeverities.some((severity) => severity === "critical" || severity === "high")) {
    return { status: "maintenance_required", rule: "open_high_or_critical_issue" };
  }
  if (facts.openIssueSeverities.length > 0) {
    // Only low/medium severities can remain at this point.
    return { status: "attention", rule: "open_low_or_medium_issue" };
  }
  if (facts.latestCompletedResult === "pass" || facts.latestCompletedResult === "pass_with_issues") {
    return { status: "ready", rule: "clear_of_issues" };
  }
  return { status: "unknown", rule: "no_signal" };
}

/**
 * Re-derives a vehicle's status from current facts and writes it if it
 * changed, along with an AuditLog entry recording the previous/new
 * status, which rule fired, and what triggered the recalculation. Runs
 * inside a transaction so two near-simultaneous callers (e.g. an
 * inspection completing and a critical issue being reported seconds
 * apart) can't race and disagree — each sees a consistent read of the
 * other's already-committed writes, or serializes against it.
 *
 * Must be called *after* the caller's own writes have committed (not
 * folded into the same batch), since it needs to read data — e.g. a
 * just-created Issue, or a just-updated Issue's new status — that the
 * caller only just wrote.
 */
async function recalculateVehicleStatus(
  orgId: string,
  vehicleId: string,
  trigger: RecalculationTrigger
): Promise<void> {
  const vehicleRef = db.doc(`organizations/${orgId}/vehicles/${vehicleId}`);

  await db.runTransaction(async (tx: Transaction) => {
    const vehicleSnap = await tx.get(vehicleRef);
    if (!vehicleSnap.exists) {
      logger.warn("recalculateVehicleStatus: vehicle not found, skipping", { orgId, vehicleId, trigger });
      return;
    }
    const currentStatus = ((vehicleSnap.data() as VehicleDoc).status ?? "unknown") as AssetStatus;

    // Reuses the same (assetType, assetId, reportedAt desc) index as
    // getVehicleIssues in the web app — filtering to open statuses is
    // done here in code rather than via a `status in [...]` clause, so
    // this doesn't need its own separate composite index.
    const issuesSnap = await tx.get(
      db
        .collection(`organizations/${orgId}/issues`)
        .where("assetType", "==", "vehicle")
        .where("assetId", "==", vehicleId)
        .orderBy("reportedAt", "desc")
    );
    const openIssueSeverities = issuesSnap.docs
      .map((d) => d.data() as { status: IssueStatus; severity: IssueSeverity })
      .filter((issue) => OPEN_ISSUE_STATUSES.includes(issue.status))
      .map((issue) => issue.severity);

    // Ordering by completedAt (rather than startedAt) naturally excludes
    // abandoned/in-progress inspections, since Firestore's orderBy skips
    // documents missing that field entirely — no extra filter needed.
    const latestInspectionSnap = await tx.get(
      db
        .collection(`organizations/${orgId}/inspections`)
        .where("assetType", "==", "vehicle")
        .where("assetId", "==", vehicleId)
        .orderBy("completedAt", "desc")
        .limit(1)
    );
    const latestCompletedResult = latestInspectionSnap.empty
      ? undefined
      : (latestInspectionSnap.docs[0].data().overallResult as VehicleStatusFacts["latestCompletedResult"]);

    const { status: newStatus, rule } = deriveVehicleStatus({
      currentStatus,
      openIssueSeverities,
      latestCompletedResult,
    });

    if (newStatus === currentStatus) {
      return;
    }

    const now = Timestamp.now();
    tx.update(vehicleRef, { status: newStatus, updatedAt: now });

    const auditRef = db.collection(`organizations/${orgId}/auditLogs`).doc();
    tx.set(auditRef, {
      organizationId: orgId,
      action: "vehicle_status_changed",
      entityType: "vehicle",
      entityId: vehicleId,
      performedBy: "system",
      metadata: {
        previousStatus: currentStatus,
        newStatus,
        rule,
        triggeredBy: trigger.source,
        triggeredByEntityId: trigger.entityId,
      },
      timestamp: now,
    });

    logger.info("recalculateVehicleStatus: status changed", {
      orgId,
      vehicleId,
      previousStatus: currentStatus,
      newStatus,
      rule,
      trigger,
    });
  });
}

// ---------------------------------------------------------------------------
// 1. onInspectionComplete
// ---------------------------------------------------------------------------

/**
 * Fires when `completedAt` transitions from unset to set on an inspection
 * (guarded so it runs exactly once per completion, not on every later
 * edit). For each failed item, creates an Issue; recalculates the
 * vehicle's status (see `recalculateVehicleStatus`) once those Issues
 * exist; creates an "inspection_due" Alert for the template's next
 * recurrence date, if the template has one; and writes an AuditLog entry
 * for the inspection itself.
 */
export const onInspectionComplete = functions.firestore
  .document("organizations/{orgId}/inspections/{inspectionId}")
  .onWrite(async (change, context) => {
    const { orgId, inspectionId } = context.params as { orgId: string; inspectionId: string };

    const after = change.after.exists ? (change.after.data() as InspectionDoc) : undefined;
    const before = change.before.exists ? (change.before.data() as InspectionDoc) : undefined;

    if (!after?.completedAt || before?.completedAt) {
      // Not a completion (deleted, still in progress, or already processed).
      return null;
    }

    const items = after.items ?? [];
    const failedItems = items.filter((item) => item.passed === false);
    const now = Timestamp.now();

    const batch = db.batch();
    const issuesCollection = db.collection(`organizations/${orgId}/issues`);

    // One Issue per failed item. Inspection items don't carry their own
    // severity rating (see TemplateItem in the web app's src/types), so
    // auto-created issues default to "medium" — a human can re-triage.
    const createdIssueIds: string[] = [];
    for (const item of failedItems) {
      const issueRef = issuesCollection.doc();
      createdIssueIds.push(issueRef.id);
      batch.set(issueRef, {
        organizationId: orgId,
        assetType: after.assetType,
        assetId: after.assetId,
        inspectionId,
        title: `Failed inspection item: ${item.itemLabel}`,
        description: item.textValue ?? null,
        severity: "medium" as IssueSeverity,
        status: "open",
        reportedByUserId: after.inspectorUserId,
        reportedAt: now,
        updatedAt: now,
      });
    }

    // Stamp the generated issueIds back onto the inspection's items/issueIds.
    // (FieldValue.arrayUnion requires at least one element, so only touch
    // issueIds when something was actually created.)
    const itemsWithIssueIds = items.map((item) => {
      const failedIndex = failedItems.indexOf(item);
      return failedIndex === -1 ? item : { ...item, issueId: createdIssueIds[failedIndex] };
    });
    batch.update(change.after.ref, {
      items: itemsWithIssueIds,
      ...(createdIssueIds.length > 0 ? { issueIds: FieldValue.arrayUnion(...createdIssueIds) } : {}),
    });

    // "inspection_due" Alert for the next recurrence, if the template
    // defines one.
    const templateSnap = await db.doc(`organizations/${orgId}/inspectionTemplates/${after.templateId}`).get();
    const recurrenceDays = templateSnap.exists ? (templateSnap.data()?.recurrenceDays as number | undefined) : undefined;
    if (recurrenceDays && recurrenceDays > 0) {
      const nextDueDate = new Date(after.completedAt.toDate().getTime() + recurrenceDays * 24 * 60 * 60 * 1000);
      const alertRef = db.collection(`organizations/${orgId}/alerts`).doc();
      batch.set(alertRef, {
        organizationId: orgId,
        type: "inspection_due",
        severity: "info",
        title: `Next inspection due for ${after.assetType} ${after.assetId}`,
        message: `Next inspection is due on ${nextDueDate.toISOString().slice(0, 10)}.`,
        relatedAssetType: after.assetType,
        relatedAssetId: after.assetId,
        relatedEntityId: after.templateId,
        relatedEntityType: "inspection_template",
        recipientRole: "fleet_manager",
        isRead: false,
        linkUrl: `/${after.assetType}s/${after.assetId}`,
        createdAt: now,
      });
    }

    // Audit log.
    const auditRef = db.collection(`organizations/${orgId}/auditLogs`).doc();
    batch.set(auditRef, {
      organizationId: orgId,
      action: "inspection_completed",
      entityType: "inspection",
      entityId: inspectionId,
      performedBy: after.inspectorUserId,
      metadata: {
        assetType: after.assetType,
        assetId: after.assetId,
        failedItemCount: failedItems.length,
        issueIds: createdIssueIds,
      },
      timestamp: now,
    });

    await batch.commit();
    logger.info("onInspectionComplete: processed inspection", {
      orgId,
      inspectionId,
      failedItemCount: failedItems.length,
    });

    // Recalculate after the above commits, so the auto-created Issues
    // (if any) are visible to it. Equipment is left alone here — that's
    // expected and not warned about; anything else means the inspection's
    // assetType is missing or invalid.
    if (after.assetType === "vehicle") {
      await recalculateVehicleStatus(orgId, after.assetId, {
        source: "onInspectionComplete",
        entityId: inspectionId,
      });
    } else if (after.assetType !== "equipment") {
      logger.warn("onInspectionComplete: unexpected assetType, skipping vehicle status recalculation", {
        orgId,
        inspectionId,
        assetType: after.assetType,
        assetId: after.assetId,
      });
    }

    return null;
  });

// ---------------------------------------------------------------------------
// 2. onIssueCreated
// ---------------------------------------------------------------------------

/**
 * Fires when a new Issue is created. Always creates a linked WorkOrder
 * (status "open", priority derived from the issue's severity). Also
 * creates a "critical_defect" Alert, but only when the issue's severity
 * is actually "critical" — tagging every issue as a critical defect
 * regardless of severity would make the alert type meaningless.
 */
export const onIssueCreated = functions.firestore
  .document("organizations/{orgId}/issues/{issueId}")
  .onCreate(async (snap, context) => {
    const { orgId, issueId } = context.params as { orgId: string; issueId: string };
    const issue = snap.data() as IssueDoc;
    const now = Timestamp.now();

    const workOrderNumber = await getNextWorkOrderNumber(orgId);
    const workOrderRef = db.collection(`organizations/${orgId}/workOrders`).doc();

    const batch = db.batch();
    batch.set(workOrderRef, {
      organizationId: orgId,
      workOrderNumber,
      assetType: issue.assetType,
      assetId: issue.assetId,
      issueIds: [issueId],
      title: `Repair: ${issue.title}`,
      description: issue.description ?? null,
      status: "open",
      priority: severityToPriority(issue.severity),
      requestedByUserId: issue.reportedByUserId,
      createdAt: now,
      updatedAt: now,
    });
    batch.update(snap.ref, { workOrderId: workOrderRef.id });

    if (issue.severity === "critical") {
      const alertRef = db.collection(`organizations/${orgId}/alerts`).doc();
      batch.set(alertRef, {
        organizationId: orgId,
        type: "critical_defect",
        severity: "critical",
        title: `Critical defect reported: ${issue.title}`,
        message: issue.description ?? null,
        relatedAssetType: issue.assetType,
        relatedAssetId: issue.assetId,
        relatedEntityId: issueId,
        relatedEntityType: "issue",
        recipientRole: "fleet_manager",
        isRead: false,
        linkUrl: `/${issue.assetType}s/${issue.assetId}`,
        createdAt: now,
      });
    }

    await batch.commit();
    logger.info("onIssueCreated: created work order", { orgId, issueId, workOrderId: workOrderRef.id });

    if (issue.assetType === "vehicle") {
      await recalculateVehicleStatus(orgId, issue.assetId, { source: "onIssueCreated", entityId: issueId });
    }

    return null;
  });

// ---------------------------------------------------------------------------
// 3. onIssueUpdated
// ---------------------------------------------------------------------------

/**
 * Fires on any write to an Issue. Only acts on a genuine transition into
 * "resolved" or "closed" from some other status (or a doc created
 * already in one of those states) — recalculates the vehicle's status so
 * a fixed defect actually clears "attention"/"maintenance_required"
 * instead of leaving it stuck there forever. Deliberately does not
 * handle the reverse direction (an issue being reopened) — that's a
 * real, symmetric gap, but out of scope here.
 */
export const onIssueUpdated = functions.firestore
  .document("organizations/{orgId}/issues/{issueId}")
  .onWrite(async (change, context) => {
    const { orgId, issueId } = context.params as { orgId: string; issueId: string };

    if (!change.after.exists) {
      return null;
    }
    const after = change.after.data() as IssueDoc;
    const before = change.before.exists ? (change.before.data() as IssueDoc) : undefined;

    const wasOpen = !before || !RESOLVED_ISSUE_STATUSES.includes(before.status);
    const isNowResolved = RESOLVED_ISSUE_STATUSES.includes(after.status);
    if (!wasOpen || !isNowResolved) {
      return null;
    }

    if (after.assetType !== "vehicle") {
      return null;
    }

    await recalculateVehicleStatus(orgId, after.assetId, { source: "onIssueUpdated", entityId: issueId });
    return null;
  });

// ---------------------------------------------------------------------------
// 4. checkEquipmentExpiration
// ---------------------------------------------------------------------------

/**
 * Runs daily at midnight Central Time. For every organization, finds
 * equipment whose `expirationDate` has passed and isn't already flagged,
 * creates an "equipment_expired" Alert for each, and sets its status to
 * "maintenance_required".
 */
export const checkEquipmentExpiration = functions.pubsub
  .schedule("0 0 * * *")
  .timeZone("America/Chicago")
  .onRun(async () => {
    const now = Timestamp.now();
    const orgsSnap = await db.collection("organizations").get();

    let totalExpired = 0;

    for (const orgDoc of orgsSnap.docs) {
      const orgId = orgDoc.id;
      const expiredSnap = await db
        .collection(`organizations/${orgId}/equipment`)
        .where("expirationDate", "<", now)
        .get();

      if (expiredSnap.empty) {
        continue;
      }

      const batch = db.batch();
      for (const equipmentDoc of expiredSnap.docs) {
        const equipment = equipmentDoc.data() as EquipmentDoc;
        // Skip equipment already flagged or otherwise out of the normal
        // ready/attention lifecycle, so this doesn't re-alert daily or
        // clobber a status like "retired".
        if (["maintenance_required", "out_of_service", "retired"].includes(equipment.status)) {
          continue;
        }

        const alertRef = db.collection(`organizations/${orgId}/alerts`).doc();
        batch.set(alertRef, {
          organizationId: orgId,
          type: "equipment_expired",
          severity: "warning",
          title: `${equipment.name} (${equipment.unitNumber}) certification expired`,
          message: `Inspection/certification expired on ${equipment.expirationDate?.toDate().toISOString().slice(0, 10)}.`,
          relatedAssetType: "equipment" as AssetType,
          relatedAssetId: equipmentDoc.id,
          relatedEntityType: "equipment",
          relatedEntityId: equipmentDoc.id,
          recipientRole: "fleet_manager",
          isRead: false,
          linkUrl: `/equipment/${equipmentDoc.id}`,
          createdAt: now,
        });

        batch.update(equipmentDoc.ref, {
          status: "maintenance_required",
          updatedAt: now,
        });
        totalExpired += 1;
      }

      await batch.commit();
    }

    logger.info("checkEquipmentExpiration: run complete", {
      organizationCount: orgsSnap.size,
      expiredEquipmentCount: totalExpired,
    });
    return null;
  });

// ---------------------------------------------------------------------------
// 5. User management (admin-only callables)
// ---------------------------------------------------------------------------
//
// firestore.rules denies every client write to
// organizations/{orgId}/users outright (a user editing their own `role`
// field would be a privilege-escalation hole) — these four callables are
// the only way that collection, and its userOrgs/{uid} lookup
// counterpart, ever get written from outside a script. Each one
// re-derives the caller's own org membership and role server-side via
// assertActiveOrgAdmin: an orgId supplied by the client is never
// trusted, only ever looked up from the caller's own uid.

type UserRole = "admin" | "fleet_manager" | "equipment_manager" | "supervisor" | "officer" | "readonly";
const USER_ROLES: UserRole[] = ["admin", "fleet_manager", "equipment_manager", "supervisor", "officer", "readonly"];

/** Mirrors `User` in the web app's `src/types`, restricted to the fields these callables actually read. */
interface UserDoc {
  role: UserRole;
  isActive: boolean;
}

interface CallerContext {
  callerUid: string;
  orgId: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Verifies the caller is signed in and is an *active* admin of *some*
 * org, and returns that org's id — resolved entirely server-side from
 * the caller's own uid (userOrgs/{uid} -> organizations/{orgId}/users/{uid}),
 * never from a client-supplied orgId. Throws HttpsError otherwise.
 */
async function assertActiveOrgAdmin(context: functions.https.CallableContext): Promise<CallerContext> {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
  }
  const callerUid = context.auth.uid;

  const userOrgSnap = await db.doc(`userOrgs/${callerUid}`).get();
  const orgId = userOrgSnap.exists ? (userOrgSnap.data()?.organizationId as string | undefined) : undefined;
  if (!orgId) {
    throw new functions.https.HttpsError("permission-denied", "Caller has no organization membership.");
  }

  const callerSnap = await db.doc(`organizations/${orgId}/users/${callerUid}`).get();
  const caller = callerSnap.data() as UserDoc | undefined;
  if (!callerSnap.exists || caller?.role !== "admin" || caller?.isActive !== true) {
    throw new functions.https.HttpsError("permission-denied", "Caller is not an active admin of this organization.");
  }

  return { callerUid, orgId };
}

/**
 * Every *other* currently-active admin in the org besides `excludeUid` —
 * used to guard the "last active admin can't be demoted/deactivated"
 * safeguard. Two equality filters (role, isActive), no orderBy —
 * Firestore serves this off its automatic single-field indexes via an
 * index merge, no composite index needed.
 */
async function countOtherActiveAdmins(orgId: string, excludeUid: string): Promise<number> {
  const snap = await db
    .collection(`organizations/${orgId}/users`)
    .where("role", "==", "admin")
    .where("isActive", "==", true)
    .get();
  return snap.docs.filter((d) => d.id !== excludeUid).length;
}

// ---- inviteOrgUser ---------------------------------------------------------

interface InviteOrgUserData {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

/**
 * Creates a new user: a Firebase Auth account, their
 * organizations/{orgId}/users profile, and the matching userOrgs/{uid}
 * lookup. Admin-only, and only for the caller's own org (see
 * assertActiveOrgAdmin) — never trusts an orgId from the client.
 *
 * Deliberately does NOT send the password-reset email itself: the Admin
 * SDK can generate a reset *link* (`generatePasswordResetLink`) but has
 * no way to actually deliver an email — sending one is exclusively a
 * client SDK capability (`sendPasswordResetEmail`), by Firebase's own
 * design (self-service reset flows originate client-side). The web app's
 * invite form calls `sendPasswordResetEmail` immediately after this
 * function returns success (see userManagementService.ts), which is what
 * actually sends the real email via Firebase's built-in delivery
 * (Console -> Authentication -> Templates controls its content). If that
 * follow-up call fails, the account and profile still exist — the admin
 * can tell the invitee to use "Forgot password" on the login page
 * instead, which is the exact same underlying mechanism.
 */
export const inviteOrgUser = functions.https.onCall(async (data: InviteOrgUserData, context) => {
  const { orgId, callerUid } = await assertActiveOrgAdmin(context);

  const email = isNonEmptyString(data?.email) ? data.email.trim().toLowerCase() : "";
  const firstName = isNonEmptyString(data?.firstName) ? data.firstName.trim() : "";
  const lastName = isNonEmptyString(data?.lastName) ? data.lastName.trim() : "";
  const role = data?.role;

  if (!email || !email.includes("@")) {
    throw new functions.https.HttpsError("invalid-argument", "A valid email is required.");
  }
  if (!firstName || !lastName) {
    throw new functions.https.HttpsError("invalid-argument", "First and last name are required.");
  }
  if (!USER_ROLES.includes(role)) {
    throw new functions.https.HttpsError("invalid-argument", `role must be one of: ${USER_ROLES.join(", ")}`);
  }

  let existing;
  try {
    existing = await adminAuth.getUserByEmail(email);
  } catch (err) {
    if ((err as { code?: string })?.code !== "auth/user-not-found") {
      logger.error("inviteOrgUser: unexpected error checking for an existing account", err);
      throw new functions.https.HttpsError("internal", "Failed to check for an existing account.");
    }
  }
  if (existing) {
    throw new functions.https.HttpsError("already-exists", `A user with email ${email} already exists.`);
  }

  let userRecord;
  try {
    userRecord = await adminAuth.createUser({ email, displayName: `${firstName} ${lastName}`, emailVerified: false });
  } catch (err) {
    logger.error("inviteOrgUser: auth.createUser failed", err);
    throw new functions.https.HttpsError("internal", "Failed to create the Auth account.");
  }

  const now = Timestamp.now();
  try {
    const batch = db.batch();
    batch.set(db.doc(`organizations/${orgId}/users/${userRecord.uid}`), {
      organizationId: orgId,
      email,
      firstName,
      lastName,
      role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    batch.set(db.doc(`userOrgs/${userRecord.uid}`), { organizationId: orgId, email });
    batch.set(db.collection(`organizations/${orgId}/auditLogs`).doc(), {
      organizationId: orgId,
      action: "user_invited",
      entityType: "user",
      entityId: userRecord.uid,
      performedBy: callerUid,
      metadata: { email, role },
      timestamp: now,
    });
    await batch.commit();
  } catch (err) {
    // Don't leave an orphaned Auth account with no profile if the
    // Firestore writes fail after it was already created.
    logger.error("inviteOrgUser: Firestore write failed after Auth account creation — rolling back", err);
    await adminAuth.deleteUser(userRecord.uid).catch((cleanupErr) => {
      logger.error(`inviteOrgUser: rollback also failed — Auth account ${userRecord.uid} is now orphaned`, cleanupErr);
    });
    throw new functions.https.HttpsError("internal", "Failed to create the user profile.");
  }

  return { uid: userRecord.uid, email };
});

// ---- changeOrgUserRole ------------------------------------------------------

interface ChangeOrgUserRoleData {
  targetUid: string;
  newRole: UserRole;
}

/**
 * Changes another user's role. Two safeguards, both server-enforced
 * (the client UI also disables the relevant controls, but this is what
 * actually stops it):
 *  - An admin can't change their own role at all — targetUid === caller
 *    is rejected outright, regardless of what newRole is.
 *  - Demoting the org's last *active* admin away from "admin" is
 *    rejected — that would leave nobody able to manage users, change
 *    roles, or write inspectionTemplates.
 */
export const changeOrgUserRole = functions.https.onCall(async (data: ChangeOrgUserRoleData, context) => {
  const { orgId, callerUid } = await assertActiveOrgAdmin(context);

  const targetUid = isNonEmptyString(data?.targetUid) ? data.targetUid : "";
  const newRole = data?.newRole;
  if (!targetUid) {
    throw new functions.https.HttpsError("invalid-argument", "targetUid is required.");
  }
  if (!USER_ROLES.includes(newRole)) {
    throw new functions.https.HttpsError("invalid-argument", `newRole must be one of: ${USER_ROLES.join(", ")}`);
  }
  if (targetUid === callerUid) {
    throw new functions.https.HttpsError("failed-precondition", "You can't change your own role.");
  }

  const targetRef = db.doc(`organizations/${orgId}/users/${targetUid}`);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new functions.https.HttpsError("not-found", "User not found in this organization.");
  }
  const target = targetSnap.data() as UserDoc;

  const isDemotingAnActiveAdmin = target.role === "admin" && target.isActive === true && newRole !== "admin";
  if (isDemotingAnActiveAdmin && (await countOtherActiveAdmins(orgId, targetUid)) === 0) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "This is the last active admin in the organization — promote another admin first."
    );
  }

  const now = Timestamp.now();
  const batch = db.batch();
  batch.update(targetRef, { role: newRole, updatedAt: now });
  batch.set(db.collection(`organizations/${orgId}/auditLogs`).doc(), {
    organizationId: orgId,
    action: "user_role_changed",
    entityType: "user",
    entityId: targetUid,
    performedBy: callerUid,
    metadata: { previousRole: target.role, newRole },
    timestamp: now,
  });
  await batch.commit();

  return { uid: targetUid, role: newRole };
});

// ---- deactivateOrgUser / reactivateOrgUser ----------------------------------

interface TargetUserData {
  targetUid: string;
}

/**
 * Deactivates a user: blocks sign-in (not just hides them). Two things
 * happen, in this order and for this reason:
 *  1. `organizations/{orgId}/users/{targetUid}.isActive` is set to
 *     false, first. firestore.rules' `isOrgMember` checks this field on
 *     *every* request, so this is what takes effect immediately, even
 *     for a session with an ID token that hasn't expired yet.
 *  2. The Firebase Auth account is disabled and its refresh tokens are
 *     revoked, best-effort. This blocks any *new* sign-in outright and
 *     forces an already-open session to fail its next token refresh
 *     rather than riding out its full lifetime — real hardening, but
 *     secondary: if this step fails, the user is already fully blocked
 *     by step 1, so a failure here is logged rather than rolled back or
 *     surfaced as the whole operation failing.
 *
 * Refuses to deactivate the org's last active admin — see
 * countOtherActiveAdmins.
 */
export const deactivateOrgUser = functions.https.onCall(async (data: TargetUserData, context) => {
  const { orgId, callerUid } = await assertActiveOrgAdmin(context);

  const targetUid = isNonEmptyString(data?.targetUid) ? data.targetUid : "";
  if (!targetUid) {
    throw new functions.https.HttpsError("invalid-argument", "targetUid is required.");
  }

  const targetRef = db.doc(`organizations/${orgId}/users/${targetUid}`);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new functions.https.HttpsError("not-found", "User not found in this organization.");
  }
  const target = targetSnap.data() as UserDoc;

  if (target.role === "admin" && target.isActive === true && (await countOtherActiveAdmins(orgId, targetUid)) === 0) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "This is the last active admin in the organization — promote another admin before deactivating this one."
    );
  }

  const now = Timestamp.now();
  const batch = db.batch();
  batch.update(targetRef, { isActive: false, updatedAt: now });
  batch.set(db.collection(`organizations/${orgId}/auditLogs`).doc(), {
    organizationId: orgId,
    action: "user_deactivated",
    entityType: "user",
    entityId: targetUid,
    performedBy: callerUid,
    metadata: { role: target.role },
    timestamp: now,
  });
  await batch.commit();

  try {
    await adminAuth.updateUser(targetUid, { disabled: true });
    await adminAuth.revokeRefreshTokens(targetUid);
  } catch (err) {
    logger.error(`deactivateOrgUser: Firestore updated but Auth disable/revoke failed for ${targetUid}`, err);
  }

  return { uid: targetUid };
});

/**
 * Reactivates a user. No "last admin" restriction — reactivating only
 * ever increases the org's active-admin count, never decreases it.
 *
 * Order is deliberately the opposite of deactivateOrgUser: the Auth
 * account is re-enabled *first*, and the whole call fails if that fails.
 * Setting isActive:true in Firestore before confirming the Auth account
 * is actually re-enabled would produce a confusing "active but still
 * can't sign in" state; failing closed here avoids that.
 */
export const reactivateOrgUser = functions.https.onCall(async (data: TargetUserData, context) => {
  const { orgId, callerUid } = await assertActiveOrgAdmin(context);

  const targetUid = isNonEmptyString(data?.targetUid) ? data.targetUid : "";
  if (!targetUid) {
    throw new functions.https.HttpsError("invalid-argument", "targetUid is required.");
  }

  const targetRef = db.doc(`organizations/${orgId}/users/${targetUid}`);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new functions.https.HttpsError("not-found", "User not found in this organization.");
  }

  try {
    await adminAuth.updateUser(targetUid, { disabled: false });
  } catch (err) {
    // auth/user-not-found means this profile is orphaned — its uid was
    // never a real Auth account (a stale placeholder from an old seed
    // run) or the account has since been deleted from Auth. That's a
    // distinct, expected-to-happen situation, not an unexpected server
    // failure: surface it as such (failed-precondition, a clear message)
    // rather than letting it fall through to a generic 500. See
    // setup-demo.ts's --reset for how these get cleaned up.
    if ((err as { code?: string })?.code === "auth/user-not-found") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "This profile has no corresponding Firebase Auth account — it can't be reactivated. " +
          "It's orphaned (likely from a past seed/migration mistake); delete the profile instead of reactivating it."
      );
    }
    logger.error(`reactivateOrgUser: Auth re-enable failed for ${targetUid}`, err);
    throw new functions.https.HttpsError("internal", "Failed to re-enable the Auth account.");
  }

  const now = Timestamp.now();
  const batch = db.batch();
  batch.update(targetRef, { isActive: true, updatedAt: now });
  batch.set(db.collection(`organizations/${orgId}/auditLogs`).doc(), {
    organizationId: orgId,
    action: "user_reactivated",
    entityType: "user",
    entityId: targetUid,
    performedBy: callerUid,
    metadata: {},
    timestamp: now,
  });
  await batch.commit();

  return { uid: targetUid };
});

// ---- checkOrphanedUsers -----------------------------------------------------

/**
 * Cross-references every organizations/{orgId}/users profile against
 * Firebase Auth and returns the uids with no matching Auth account —
 * orphaned profiles that reactivateOrgUser will refuse to reactivate
 * (see its auth/user-not-found handling above). The client can't
 * determine this itself: checking whether an arbitrary uid has an Auth
 * account isn't something the client SDK can do for anyone but the
 * signed-in user, so this has to be a server-side, Admin-SDK lookup.
 * Read-only — admin-only per assertActiveOrgAdmin, same as the rest of
 * this section, but doesn't write anything (not even an audit log —
 * there's nothing to record, this only reports existing state).
 */
export const checkOrphanedUsers = functions.https.onCall(async (_data, context) => {
  const { orgId } = await assertActiveOrgAdmin(context);

  const snap = await db.collection(`organizations/${orgId}/users`).get();
  if (snap.empty) {
    return { orphanedUids: [] };
  }

  const foundUids = new Set<string>();
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 100) {
    const chunk = docs.slice(i, i + 100);
    const result = await adminAuth.getUsers(chunk.map((d) => ({ uid: d.id })));
    result.users.forEach((u) => foundUids.add(u.uid));
  }

  return { orphanedUids: docs.map((d) => d.id).filter((uid) => !foundUids.has(uid)) };
});
