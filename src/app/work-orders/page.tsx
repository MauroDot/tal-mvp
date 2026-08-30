"use client";

/**
 * Work order list: every work order in the org, filterable by status,
 * sorted priority-first (urgent surfaces at the top).
 *
 * Gated to ROUTE_ROLES.workOrders (admin/fleet_manager/supervisor) — the
 * same roles that can write a WorkOrder per firestore.rules.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AccessDenied from "@/components/AccessDenied";
import Layout from "@/components/Layout";
import { formatDate } from "@/lib/dateUtils";
import { ROUTE_ROLES } from "@/lib/routeAccess";
import { useRequireRole } from "@/hooks/useRequireRole";
import { getIssue } from "@/services/inspectionService";
import { getVehicle } from "@/services/vehicleService";
import { listWorkOrders } from "@/services/workOrderService";
import type { IssueSeverity, WorkOrder, WorkOrderPriority, WorkOrderStatus } from "@/types";

/** Statuses that count as "done" — no longer active work. */
const TERMINAL_STATUSES: readonly WorkOrderStatus[] = ["completed", "cancelled"];

/**
 * "open"/"closed" group not-completed/completed-or-cancelled work, distinct
 * from the literal "open" WorkOrderStatus (which means specifically
 * status === "open", excluding acknowledged/in_progress) — this is a
 * grouping over the whole status field, not one value of it.
 */
type ListFilter = "open" | "closed" | "all";

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

const PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

const PRIORITY_STYLES: Record<WorkOrderPriority, string> = {
  urgent: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  normal: "bg-gray-100 text-gray-700",
  low: "bg-gray-100 text-gray-500",
};

// Urgent first, matching the request literally — Firestore can't sort a
// string field into this custom order, so this is a client-side sort key.
const PRIORITY_SORT_ORDER: Record<WorkOrderPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

const SEVERITY_STYLES: Record<IssueSeverity, string> = {
  low: "bg-gray-100 text-gray-700",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};

interface WorkOrderRowDetail {
  vehicleUnitNumber: string | null;
  issueTitle: string | null;
  issueSeverity: IssueSeverity | null;
}

export default function WorkOrdersPage() {
  const { status, user } = useRequireRole(ROUTE_ROLES.workOrders);

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [rowDetails, setRowDetails] = useState<Record<string, WorkOrderRowDetail>>({});
  const [loadingWorkOrders, setLoadingWorkOrders] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Defaults to "open" — completed/cancelled orders otherwise pile up
  // with no way to get them out of view.
  const [statusFilter, setStatusFilter] = useState<ListFilter>("open");

  useEffect(() => {
    if (status !== "allowed" || !user) {
      return;
    }
    let cancelled = false;

    async function loadWorkOrders(currentUser: NonNullable<typeof user>) {
      setLoadingWorkOrders(true);
      setError(null);

      let results: WorkOrder[];
      try {
        results = await listWorkOrders(currentUser.organizationId);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load work orders.");
          setLoadingWorkOrders(false);
        }
        return;
      }
      if (cancelled) {
        return;
      }
      setWorkOrders(results);
      setLoadingWorkOrders(false);

      try {
        const detailEntries = await Promise.all(
          results.map(async (wo) => {
            const [vehicle, issue] = await Promise.all([
              wo.assetType === "vehicle" ? getVehicle(currentUser.organizationId, wo.assetId) : null,
              wo.issueIds[0] ? getIssue(currentUser.organizationId, wo.issueIds[0]) : null,
            ]);
            const detail: WorkOrderRowDetail = {
              vehicleUnitNumber: vehicle?.unitNumber ?? null,
              issueTitle: issue?.title ?? null,
              issueSeverity: issue?.severity ?? null,
            };
            return [wo.id, detail] as const;
          })
        );

        if (!cancelled) {
          setRowDetails(Object.fromEntries(detailEntries));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load work order details.");
        }
      }
    }

    loadWorkOrders(user);
    return () => {
      cancelled = true;
    };
  }, [status, user]);

  const visibleWorkOrders = useMemo(() => {
    return workOrders
      .filter((wo) => {
        if (statusFilter === "all") {
          return true;
        }
        const isTerminal = TERMINAL_STATUSES.includes(wo.status);
        return statusFilter === "closed" ? isTerminal : !isTerminal;
      })
      .slice()
      .sort((a, b) => {
        const priorityDelta = PRIORITY_SORT_ORDER[a.priority] - PRIORITY_SORT_ORDER[b.priority];
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
      });
  }, [workOrders, statusFilter]);

  return (
    <Layout>
      {status === "loading" ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : status === "denied" ? (
        <AccessDenied requiredRoles={ROUTE_ROLES.workOrders} />
      ) : (
        <div className="mx-auto max-w-6xl">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Work Orders</h1>
            <p className="mt-1 text-sm text-gray-500">Every work order in your organization.</p>
          </div>

          {error && (
            <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {loadingWorkOrders ? (
            <p className="text-sm text-gray-500">Loading work orders…</p>
          ) : (
            <>
              <div className="mb-4">
                <label htmlFor="status-filter" className="mb-1 block text-xs font-medium text-gray-500">
                  Filter by status
                </label>
                <select
                  id="status-filter"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as ListFilter)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  <option value="all">All</option>
                </select>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                {visibleWorkOrders.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-500">
                    {workOrders.length === 0 ? "No work orders yet." : "No work orders match this filter."}
                  </div>
                ) : (
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-3">WO #</th>
                        <th className="px-4 py-3">Vehicle</th>
                        <th className="px-4 py-3">Issue</th>
                        <th className="px-4 py-3">Severity</th>
                        <th className="px-4 py-3">Priority</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Opened</th>
                        <th className="px-4 py-3">Assigned To</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {visibleWorkOrders.map((wo) => {
                        const detail = rowDetails[wo.id];
                        return (
                          <tr key={wo.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium text-gray-900">
                              <Link href={`/work-orders/${wo.id}`} className="hover:text-blue-700 hover:underline">
                                {wo.workOrderNumber}
                              </Link>
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {!detail
                                ? "…"
                                : detail.vehicleUnitNumber
                                  ? `Unit ${detail.vehicleUnitNumber}`
                                  : wo.assetType === "vehicle"
                                    ? "—"
                                    : "(equipment)"}
                            </td>
                            <td className="max-w-[220px] truncate px-4 py-3 text-gray-600">
                              {!detail ? "…" : (detail.issueTitle ?? "—")}
                            </td>
                            <td className="px-4 py-3">
                              {detail?.issueSeverity ? (
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[detail.issueSeverity]}`}
                                >
                                  {detail.issueSeverity}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[wo.priority]}`}
                              >
                                {PRIORITY_LABELS[wo.priority]}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[wo.status]}`}
                              >
                                {STATUS_LABELS[wo.status]}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-600">{formatDate(wo.createdAt)}</td>
                            <td className="px-4 py-3 text-gray-600">{wo.assignedTo ?? "Unassigned"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Layout>
  );
}
