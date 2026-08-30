"use client";

/**
 * Work order detail: full issue context (including photos) and controls
 * to move the work order open -> acknowledged -> in_progress -> completed,
 * or cancel it from any non-terminal state. Completing prompts for
 * resolution notes and an optional maintenance record, then resolves the
 * linked issue(s) — which is what fires onIssueUpdated ->
 * recalculateVehicleStatus (functions/src/index.ts) and can move the
 * vehicle back to "ready". Cancelling similarly closes the linked
 * issue(s) with the cancellation reason as their resolution note, so a
 * false-alarm defect doesn't leave the vehicle stuck at
 * attention/maintenance_required forever (see cancelWorkOrder).
 *
 * Also has an editable free-text "Assigned To" — same roles that can
 * change status (ROUTE_ROLES.workOrders, already gating this whole page).
 *
 * Wrapped in <Suspense> because dynamic route `params` is a Promise in
 * this Next.js version, unwrapped via React's `use()` — which suspends
 * the calling component (same reasoning as vehicle/[id]/page.tsx).
 */
import { Suspense, use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import Layout from "@/components/Layout";
import { formatDate } from "@/lib/dateUtils";
import { ROUTE_ROLES } from "@/lib/routeAccess";
import { useRequireRole } from "@/hooks/useRequireRole";
import { getDefectPhotoUrl, getIssue } from "@/services/inspectionService";
import { getUserProfile, listUsers } from "@/services/organizationService";
import { createMaintenanceRecord, getVehicle } from "@/services/vehicleService";
import {
  assignWorkOrder,
  cancelWorkOrder,
  completeWorkOrder,
  getWorkOrder,
  updateWorkOrderStatus,
} from "@/services/workOrderService";
import type { Issue, IssueSeverity, Vehicle, WorkOrder, WorkOrderStatus } from "@/types";

/** Statuses a work order can still be cancelled from — mirrors workOrderService's CANCELLABLE_STATUSES. */
const CANCELLABLE_STATUSES: readonly WorkOrderStatus[] = ["open", "acknowledged", "in_progress"];

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_STYLES: Record<WorkOrderStatus, string> = {
  open: "bg-gray-100 text-gray-700",
  acknowledged: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-200 text-gray-500",
};

const SEVERITY_STYLES: Record<IssueSeverity, string> = {
  low: "bg-gray-100 text-gray-700",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};

/** The next status a linear "move it forward" action reaches, if any. */
const NEXT_STATUS: Partial<Record<WorkOrderStatus, Exclude<WorkOrderStatus, "completed">>> = {
  open: "acknowledged",
  acknowledged: "in_progress",
};

function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: workOrderId } = use(params);
  const router = useRouter();
  const { status: authStatus, user } = useRequireRole(ROUTE_ROLES.workOrders);

  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issuePhotoUrls, setIssuePhotoUrls] = useState<Record<string, string[]>>({});
  const [requestedByName, setRequestedByName] = useState<string | null>(null);
  // { id, name } rather than plain strings: two users can legitimately
  // share a display name, so the datalist's <option> keys need something
  // actually unique (the uid) — the name alone can't be trusted as a key.
  const [orgUsers, setOrgUsers] = useState<{ id: string; name: string }[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [resolutionNotes, setResolutionNotes] = useState("");
  const [maintenanceType, setMaintenanceType] = useState("");
  const [maintenanceVendor, setMaintenanceVendor] = useState("");
  const [maintenanceCost, setMaintenanceCost] = useState("");
  const [maintenanceMileage, setMaintenanceMileage] = useState("");
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const [assignedToInput, setAssignedToInput] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;

    async function load(currentUser: NonNullable<typeof user>) {
      setLoadingData(true);
      setLoadError(null);
      try {
        const workOrderResult = await getWorkOrder(currentUser.organizationId, workOrderId);
        if (cancelled) {
          return;
        }
        if (!workOrderResult) {
          throw new Error("Work order not found.");
        }
        setWorkOrder(workOrderResult);
        setAssignedToInput(workOrderResult.assignedTo ?? "");

        const [vehicleResult, issueResults] = await Promise.all([
          workOrderResult.assetType === "vehicle"
            ? getVehicle(currentUser.organizationId, workOrderResult.assetId)
            : Promise.resolve(null),
          Promise.all(
            workOrderResult.issueIds.map((issueId) => getIssue(currentUser.organizationId, issueId))
          ),
        ]);
        if (cancelled) {
          return;
        }
        const foundIssues = issueResults.filter((issue): issue is Issue => issue !== null);
        setVehicle(vehicleResult);
        setIssues(foundIssues);

        const photoEntries = await Promise.all(
          foundIssues.map(async (issue) => {
            const urls = await Promise.all(
              (issue.photoIds ?? []).map((photoId) => getDefectPhotoUrl(currentUser.organizationId, photoId))
            );
            return [issue.id, urls] as const;
          })
        );
        if (!cancelled) {
          setIssuePhotoUrls(Object.fromEntries(photoEntries));
        }

        const [requestedProfile, orgUserProfiles] = await Promise.all([
          getUserProfile(currentUser.organizationId, workOrderResult.requestedByUserId),
          listUsers(currentUser.organizationId),
        ]);
        if (!cancelled) {
          setRequestedByName(requestedProfile ? `${requestedProfile.firstName} ${requestedProfile.lastName}` : null);
          setOrgUsers(orgUserProfiles.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}` })));
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load work order.");
        }
      } finally {
        if (!cancelled) {
          setLoadingData(false);
        }
      }
    }

    load(user);
    return () => {
      cancelled = true;
    };
  }, [user, workOrderId]);

  async function handleAdvanceStatus() {
    if (!user || !workOrder) {
      return;
    }
    const next = NEXT_STATUS[workOrder.status];
    if (!next) {
      return;
    }
    setUpdatingStatus(true);
    setStatusError(null);
    try {
      await updateWorkOrderStatus(user.organizationId, workOrder.id, next);
      setWorkOrder({ ...workOrder, status: next });
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to update status.");
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleComplete() {
    if (!user || !workOrder) {
      return;
    }
    const notes = resolutionNotes.trim();
    if (!notes) {
      setCompleteError("Resolution notes are required to complete a work order.");
      return;
    }
    setCompleting(true);
    setCompleteError(null);
    try {
      await completeWorkOrder(user.organizationId, workOrder.id, notes);

      const type = maintenanceType.trim();
      if (type) {
        const cost = maintenanceCost.trim() ? Number(maintenanceCost) : undefined;
        const mileage = maintenanceMileage.trim() ? Number(maintenanceMileage) : undefined;
        await createMaintenanceRecord(user.organizationId, {
          assetType: workOrder.assetType,
          assetId: workOrder.assetId,
          maintenanceType: type,
          performedBy: maintenanceVendor.trim() || undefined,
          cost: cost !== undefined && !Number.isNaN(cost) ? cost : undefined,
          meterReadingAtService: mileage !== undefined && !Number.isNaN(mileage) ? mileage : undefined,
          performedAt: new Date().toISOString(),
        });
      }

      router.push("/work-orders");
    } catch (err) {
      setCompleting(false);
      setCompleteError(err instanceof Error ? err.message : "Failed to complete work order.");
    }
  }

  async function handleAssign() {
    if (!user || !workOrder) {
      return;
    }
    setAssigning(true);
    setAssignError(null);
    try {
      await assignWorkOrder(user.organizationId, workOrder.id, assignedToInput);
      const trimmed = assignedToInput.trim();
      setWorkOrder({ ...workOrder, assignedTo: trimmed || undefined });
      setAssignedToInput(trimmed);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Failed to update assignment.");
    } finally {
      setAssigning(false);
    }
  }

  async function handleCancel() {
    if (!user || !workOrder) {
      return;
    }
    const reason = cancelReason.trim();
    if (!reason) {
      setCancelError("A reason is required to cancel a work order.");
      return;
    }
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelWorkOrder(user.organizationId, workOrder.id, reason);
      router.push("/work-orders");
    } catch (err) {
      setCancelling(false);
      setCancelError(err instanceof Error ? err.message : "Failed to cancel work order.");
    }
  }

  const isResolvingAuth = authStatus === "loading";
  const canCancel = workOrder ? CANCELLABLE_STATUSES.includes(workOrder.status) : false;
  // Suggestions are by display name, but names aren't unique — collapse to
  // one <option> per distinct name (keyed on the first matching uid) so
  // the datalist doesn't offer the same name twice.
  const uniqueSuggestedUsers = Array.from(new Map(orgUsers.map((u) => [u.name, u])).values());

  return (
    <Layout>
      {isResolvingAuth ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : authStatus === "denied" ? (
        <AccessDenied requiredRoles={ROUTE_ROLES.workOrders} />
      ) : loadingData ? (
        <p className="text-sm text-gray-500">Loading work order…</p>
      ) : loadError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </p>
      ) : workOrder ? (
        <div className="mx-auto max-w-2xl space-y-4">
          {/* Work order summary */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-gray-900">{workOrder.workOrderNumber}</h1>
                <p className="mt-1 text-sm text-gray-500">{workOrder.title}</p>
                {vehicle && (
                  <p className="mt-1 text-xs text-gray-400">
                    Unit {vehicle.unitNumber} — {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")}
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLES[workOrder.status]}`}
              >
                {STATUS_LABELS[workOrder.status]}
              </span>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Opened</dt>
                <dd className="mt-0.5 text-sm font-medium text-gray-900">{formatDate(workOrder.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Requested By</dt>
                <dd className="mt-0.5 text-sm font-medium text-gray-900">{requestedByName ?? "—"}</dd>
              </div>
            </dl>

            {/* Assigned To — free text, org users offered as suggestions only.
                Small departments route most work to outside shops, so this
                can't be restricted to user accounts (see WorkOrder.assignedTo). */}
            <div className="mt-4 border-t border-gray-100 pt-4">
              <label htmlFor="assigned-to" className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
                Assigned To
              </label>
              <div className="flex gap-2">
                <input
                  id="assigned-to"
                  type="text"
                  list="org-user-suggestions"
                  value={assignedToInput}
                  onChange={(event) => setAssignedToInput(event.target.value)}
                  placeholder="Officer name or outside shop"
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <datalist id="org-user-suggestions">
                  {uniqueSuggestedUsers.map((u) => (
                    <option key={u.id} value={u.name} />
                  ))}
                </datalist>
                <button
                  type="button"
                  onClick={handleAssign}
                  disabled={assigning || assignedToInput.trim() === (workOrder.assignedTo ?? "")}
                  className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {assigning ? "Saving…" : "Save"}
                </button>
              </div>
              {assignError && <p className="mt-1 text-xs text-red-600">{assignError}</p>}
            </div>
          </div>

          {/* Linked issue(s) */}
          {issues.map((issue) => (
            <div key={issue.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-sm font-semibold text-gray-900">{issue.title}</h2>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[issue.severity]}`}
                >
                  {issue.severity}
                </span>
              </div>
              {issue.description && <p className="mt-2 text-sm text-gray-600">{issue.description}</p>}
              {(issuePhotoUrls[issue.id]?.length ?? 0) > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {issuePhotoUrls[issue.id].map((url, index) => (
                    // eslint-disable-next-line @next/next/no-img-element -- Storage-hosted photo, not an optimizable local/remote asset known at build time
                    <img
                      key={url}
                      src={url}
                      alt={`${issue.title} photo ${index + 1}`}
                      className="aspect-square w-full rounded-md border border-gray-200 object-cover"
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

          {statusError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {statusError}
            </p>
          )}

          {/* Status progression */}
          {NEXT_STATUS[workOrder.status] && (
            <button
              type="button"
              onClick={handleAdvanceStatus}
              disabled={updatingStatus}
              className="w-full rounded-md bg-blue-600 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {updatingStatus
                ? "Updating…"
                : workOrder.status === "open"
                  ? "Acknowledge"
                  : "Start Work"}
            </button>
          )}

          {workOrder.status === "in_progress" && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              <h2 className="text-sm font-semibold text-gray-900">Complete Work Order</h2>

              {completeError && (
                <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {completeError}
                </p>
              )}

              <div className="mt-3">
                <label htmlFor="resolution-notes" className="mb-1 block text-xs font-medium text-gray-500">
                  Resolution Notes
                </label>
                <textarea
                  id="resolution-notes"
                  value={resolutionNotes}
                  onChange={(event) => setResolutionNotes(event.target.value)}
                  rows={3}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="What was done to resolve this?"
                />
              </div>

              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-400">
                Maintenance Record (optional)
              </p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="maintenance-type" className="mb-1 block text-xs font-medium text-gray-500">
                    Type
                  </label>
                  <input
                    id="maintenance-type"
                    type="text"
                    value={maintenanceType}
                    onChange={(event) => setMaintenanceType(event.target.value)}
                    placeholder="e.g. brake_service"
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="maintenance-vendor" className="mb-1 block text-xs font-medium text-gray-500">
                    Vendor / Performed By
                  </label>
                  <input
                    id="maintenance-vendor"
                    type="text"
                    value={maintenanceVendor}
                    onChange={(event) => setMaintenanceVendor(event.target.value)}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="maintenance-cost" className="mb-1 block text-xs font-medium text-gray-500">
                    Cost
                  </label>
                  <input
                    id="maintenance-cost"
                    type="number"
                    inputMode="decimal"
                    value={maintenanceCost}
                    onChange={(event) => setMaintenanceCost(event.target.value)}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="maintenance-mileage" className="mb-1 block text-xs font-medium text-gray-500">
                    Mileage
                  </label>
                  <input
                    id="maintenance-mileage"
                    type="number"
                    inputMode="numeric"
                    value={maintenanceMileage}
                    onChange={(event) => setMaintenanceMileage(event.target.value)}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleComplete}
                disabled={completing || !resolutionNotes.trim()}
                className="mt-4 w-full rounded-md bg-green-600 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-green-300"
              >
                {completing ? "Completing…" : "Complete Work Order"}
              </button>
            </div>
          )}

          {/* Cancel — reachable from open/acknowledged/in_progress, not completed */}
          {canCancel && (
            <div className="rounded-lg border border-red-200 bg-white p-4 shadow-sm sm:p-6">
              {!showCancelForm ? (
                <button
                  type="button"
                  onClick={() => setShowCancelForm(true)}
                  className="text-sm font-medium text-red-600 hover:text-red-800 hover:underline"
                >
                  Cancel Work Order
                </button>
              ) : (
                <>
                  <h2 className="text-sm font-semibold text-gray-900">Cancel Work Order</h2>
                  <p className="mt-1 text-xs text-gray-500">
                    E.g. the vehicle was sold, or the defect turned out to be nothing. Any linked issue(s) will be
                    closed with this reason as the note.
                  </p>

                  {cancelError && (
                    <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                      {cancelError}
                    </p>
                  )}

                  <div className="mt-3">
                    <label htmlFor="cancel-reason" className="mb-1 block text-xs font-medium text-gray-500">
                      Reason
                    </label>
                    <textarea
                      id="cancel-reason"
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                      rows={3}
                      className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                      placeholder="Why is this work order being cancelled?"
                    />
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCancelForm(false);
                        setCancelReason("");
                        setCancelError(null);
                      }}
                      disabled={cancelling}
                      className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Never mind
                    </button>
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={cancelling || !cancelReason.trim()}
                      className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-red-300"
                    >
                      {cancelling ? "Cancelling…" : "Confirm Cancellation"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ) : null}
    </Layout>
  );
}

function WorkOrderDetailFallback() {
  return (
    <Layout>
      <p className="text-sm text-gray-500">Loading…</p>
    </Layout>
  );
}

export default function WorkOrderPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<WorkOrderDetailFallback />}>
      <WorkOrderDetailPage params={props.params} />
    </Suspense>
  );
}
