/**
 * Work order data access, backed by Firestore. Schema:
 *   organizations/{orgId}/workOrders/{workOrderId} -> WorkOrder
 *
 * WorkOrders are created exclusively by the onIssueCreated Cloud
 * Function (functions/src/index.ts) via the Admin SDK — nothing in the
 * client creates one directly. This file only reads them, moves them
 * through their status lifecycle (including cancellation), and updates
 * the free-text assignment.
 */
import { collection, deleteField, doc, getDoc, getDocs, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../lib/firebase";
import { convertTimestamps } from "../lib/firestoreUtils";
import type { WorkOrder, WorkOrderStatus } from "../types";

/** Statuses a work order can still be cancelled from — not "completed", and not already "cancelled". */
const CANCELLABLE_STATUSES: readonly WorkOrderStatus[] = ["open", "acknowledged", "in_progress"];

/**
 * Fetches a single WorkOrder by ID from `organizations/{orgId}/workOrders/{workOrderId}`.
 * Returns `null` if no such document exists.
 */
export async function getWorkOrder(orgId: string, workOrderId: string): Promise<WorkOrder | null> {
  const snapshot = await getDoc(doc(db, "organizations", orgId, "workOrders", workOrderId));
  if (!snapshot.exists()) {
    return null;
  }
  return convertTimestamps<WorkOrder>({ id: snapshot.id, organizationId: orgId, ...snapshot.data() });
}

/**
 * Lists every work order in an organization. No server-side filter or
 * sort — the list page filters by status and sorts by priority
 * client-side (priority's desired "urgent first" order isn't a natural
 * Firestore sort), which also keeps this query index-free, matching
 * vehicleService.listVehicles's plain-collection-read pattern.
 */
export async function listWorkOrders(orgId: string): Promise<WorkOrder[]> {
  const snapshot = await getDocs(collection(db, "organizations", orgId, "workOrders"));
  return snapshot.docs.map((d) => convertTimestamps<WorkOrder>({ id: d.id, organizationId: orgId, ...d.data() }));
}

/**
 * Moves a work order to a new status with no other side effects. Use
 * `completeWorkOrder` instead for the "completed" transition — that one
 * also resolves the linked issue(s), which nothing here does.
 */
export async function updateWorkOrderStatus(
  orgId: string,
  workOrderId: string,
  status: Exclude<WorkOrderStatus, "completed">
): Promise<void> {
  await updateDoc(doc(db, "organizations", orgId, "workOrders", workOrderId), {
    status,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Completes a work order and resolves every issue it's linked to
 * (status -> "resolved", with the given resolution notes) in one atomic
 * batch. Resolving the issue is what fires onIssueUpdated
 * (functions/src/index.ts), which recalculates the linked vehicle's
 * status — this is the only path that can move a vehicle back to
 * "ready" after "maintenance_required"/"attention".
 */
export async function completeWorkOrder(orgId: string, workOrderId: string, resolutionNotes: string): Promise<void> {
  const workOrderRef = doc(db, "organizations", orgId, "workOrders", workOrderId);
  const workOrderSnap = await getDoc(workOrderRef);
  if (!workOrderSnap.exists()) {
    throw new Error(`Work order ${workOrderId} not found in organization ${orgId}`);
  }
  const issueIds = (workOrderSnap.data().issueIds as string[] | undefined) ?? [];

  const now = serverTimestamp();
  const batch = writeBatch(db);
  batch.update(workOrderRef, { status: "completed", updatedAt: now });
  for (const issueId of issueIds) {
    batch.update(doc(db, "organizations", orgId, "issues", issueId), {
      status: "resolved",
      resolutionNotes,
      resolvedAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();
}

/**
 * Cancels a work order that was started (or never got past triage) and
 * then called off — vehicle sold, defect turned out to be nothing, etc.
 * Allowed from "open", "acknowledged", and "in_progress"; not from
 * "completed" (already done) or "cancelled" (already terminal).
 *
 * The required reason is stored like `completeWorkOrder`'s resolution
 * notes — on the linked issue(s), in the same `resolutionNotes` field —
 * but the issue is moved to "closed" rather than "resolved": nothing was
 * actually fixed, so "resolved" would overstate it. "closed" still
 * counts as not-open (see OPEN_ISSUE_STATUSES/RESOLVED_ISSUE_STATUSES in
 * src/types and functions/src/index.ts) and still fires onIssueUpdated,
 * so a cancelled work order doesn't leave its issue — and the vehicle's
 * derived status — stuck open forever.
 */
export async function cancelWorkOrder(orgId: string, workOrderId: string, reason: string): Promise<void> {
  const workOrderRef = doc(db, "organizations", orgId, "workOrders", workOrderId);
  const workOrderSnap = await getDoc(workOrderRef);
  if (!workOrderSnap.exists()) {
    throw new Error(`Work order ${workOrderId} not found in organization ${orgId}`);
  }
  const data = workOrderSnap.data();
  const currentStatus = data.status as WorkOrderStatus;
  if (!CANCELLABLE_STATUSES.includes(currentStatus)) {
    throw new Error(`Cannot cancel a work order with status "${currentStatus}".`);
  }
  const issueIds = (data.issueIds as string[] | undefined) ?? [];

  const now = serverTimestamp();
  const batch = writeBatch(db);
  batch.update(workOrderRef, { status: "cancelled", updatedAt: now });
  for (const issueId of issueIds) {
    batch.update(doc(db, "organizations", orgId, "issues", issueId), {
      status: "closed",
      resolutionNotes: reason,
      resolvedAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();
}

/**
 * Sets or clears the free-text "Assigned To" label. An empty/whitespace
 * string clears the field entirely (rather than storing ""), matching
 * how the UI treats "no value" as "Unassigned".
 */
export async function assignWorkOrder(orgId: string, workOrderId: string, assignedTo: string): Promise<void> {
  const trimmed = assignedTo.trim();
  await updateDoc(doc(db, "organizations", orgId, "workOrders", workOrderId), {
    assignedTo: trimmed ? trimmed : deleteField(),
    updatedAt: serverTimestamp(),
  });
}
