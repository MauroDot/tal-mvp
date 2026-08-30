"use client";

/**
 * Vehicle detail page: header/status/quick stats, plus tabbed history
 * (open issues, inspections, maintenance).
 *
 * Wrapped in <Suspense> because dynamic route `params` is a Promise in
 * this Next.js version, unwrapped via React's `use()` — which suspends
 * the calling component (same reasoning as report-defect/page.tsx).
 */
import { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import StatusBadge from "@/components/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/dateUtils";
import { getUserProfile } from "@/services/organizationService";
import {
  getVehicle,
  getVehicleInspections,
  getVehicleIssues,
  getVehicleMaintenanceHistory,
} from "@/services/vehicleService";
import { OPEN_ISSUE_STATUSES } from "@/types";
import type { Inspection, Issue, IssueSeverity, IssueStatus, MaintenanceRecord, Vehicle } from "@/types";

type Tab = "issues" | "inspections" | "maintenance";

const SEVERITY_STYLES: Record<IssueSeverity, string> = {
  low: "bg-gray-100 text-gray-700",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};

const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

const RESULT_STYLES: Record<Inspection["overallResult"], string> = {
  pass: "bg-green-100 text-green-800",
  fail: "bg-red-100 text-red-800",
  pass_with_issues: "bg-yellow-100 text-yellow-800",
};

const RESULT_LABELS: Record<Inspection["overallResult"], string> = {
  pass: "Pass",
  fail: "Fail",
  pass_with_issues: "Pass w/ Issues",
};

function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: vehicleId } = use(params);
  const router = useRouter();
  const { user, firebaseUser, loading: authLoading } = useAuth();

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loadingVehicle, setLoadingVehicle] = useState(true);
  const [vehicleError, setVehicleError] = useState<string | null>(null);

  const [issues, setIssues] = useState<Issue[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<Tab>("issues");
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);

  // Redirect once auth state has resolved and no one is signed in.
  useEffect(() => {
    if (!authLoading && !firebaseUser) {
      router.replace("/auth/login");
    }
  }, [authLoading, firebaseUser, router]);

  // Load the vehicle, then its issues/inspections/maintenance, then
  // resolve the display names (assigned officer + each inspector).
  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;

    async function loadAll(currentUser: NonNullable<typeof user>) {
      setLoadingVehicle(true);
      setVehicleError(null);
      let vehicleResult: Vehicle | null;
      try {
        vehicleResult = await getVehicle(currentUser.organizationId, vehicleId);
      } catch (err) {
        if (!cancelled) {
          setVehicleError(err instanceof Error ? err.message : "Failed to load vehicle.");
          setLoadingVehicle(false);
        }
        return;
      }
      if (cancelled) {
        return;
      }
      if (!vehicleResult) {
        setVehicleError("Vehicle not found.");
        setLoadingVehicle(false);
        return;
      }
      setVehicle(vehicleResult);
      setLoadingVehicle(false);

      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const [issuesResult, inspectionsResult, maintenanceResult] = await Promise.all([
          getVehicleIssues(currentUser.organizationId, vehicleId),
          getVehicleInspections(currentUser.organizationId, vehicleId),
          getVehicleMaintenanceHistory(currentUser.organizationId, vehicleId),
        ]);
        if (cancelled) {
          return;
        }
        setIssues(issuesResult);
        setInspections(inspectionsResult);
        setMaintenance(maintenanceResult);
        setHistoryLoading(false);

        const idsToResolve = new Set<string>();
        if (vehicleResult.assignedUserId) {
          idsToResolve.add(vehicleResult.assignedUserId);
        }
        inspectionsResult.forEach((inspection) => idsToResolve.add(inspection.inspectorUserId));

        const entries = await Promise.all(
          Array.from(idsToResolve).map(async (uid) => {
            try {
              const profile = await getUserProfile(currentUser.organizationId, uid);
              return [uid, profile ? `${profile.firstName} ${profile.lastName}` : uid] as const;
            } catch {
              return [uid, uid] as const;
            }
          })
        );
        if (!cancelled) {
          setUserNames(Object.fromEntries(entries));
        }
      } catch (err) {
        if (!cancelled) {
          setHistoryError(err instanceof Error ? err.message : "Failed to load vehicle history.");
          setHistoryLoading(false);
        }
      }
    }

    loadAll(user);
    return () => {
      cancelled = true;
    };
  }, [user, vehicleId]);

  const isResolvingAuth = authLoading || !firebaseUser;
  const openIssues = issues.filter((issue) => OPEN_ISSUE_STATUSES.includes(issue.status));
  const lastInspection = inspections[0];

  return (
    <Layout>
      {isResolvingAuth ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : loadingVehicle ? (
        <p className="text-sm text-gray-500">Loading vehicle…</p>
      ) : vehicleError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {vehicleError}
        </p>
      ) : vehicle ? (
        <div className="mx-auto max-w-3xl">
          {/* Header */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Unit {vehicle.unitNumber}</h1>
                <p className="mt-1 text-sm text-gray-500">
                  {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"}
                </p>
              </div>
              <StatusBadge status={vehicle.status} className="mt-1 px-3 py-1 text-sm" />
            </div>

            {/* Quick stats */}
            <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Odometer</dt>
                <dd className="mt-0.5 text-sm font-medium text-gray-900">
                  {vehicle.odometer != null
                    ? `${vehicle.odometer.toLocaleString()} ${vehicle.odometerUnit ?? "mi"}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Assigned Officer</dt>
                <dd className="mt-0.5 text-sm font-medium text-gray-900">
                  {vehicle.assignedUserId ? (userNames[vehicle.assignedUserId] ?? "Loading…") : "Unassigned"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Last Inspection</dt>
                <dd className="mt-0.5 text-sm font-medium text-gray-900">
                  {historyLoading
                    ? "Loading…"
                    : lastInspection
                      ? formatDate(lastInspection.completedAt ?? lastInspection.startedAt)
                      : "No inspections yet"}
                </dd>
              </div>
            </dl>

            {/* Actions */}
            <div className="mt-4 flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row">
              <Link
                href={`/inspections/new?vehicleId=${vehicle.id}`}
                className="flex-1 rounded-md bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Start Inspection
              </Link>
              <Link
                href={`/vehicle/${vehicle.id}/report-defect`}
                className="flex-1 rounded-md bg-red-600 px-4 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                Report Defect
              </Link>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-6 border-b border-gray-200">
            <nav className="-mb-px flex gap-6" aria-label="Vehicle history">
              {(
                [
                  ["issues", `Open Issues${openIssues.length > 0 ? ` (${openIssues.length})` : ""}`],
                  ["inspections", "Inspection History"],
                  ["maintenance", "Maintenance"],
                ] as [Tab, string][]
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? "border-blue-600 text-blue-700"
                      : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>

          <div className="mt-4">
            {historyError && (
              <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {historyError}
              </p>
            )}

            {historyLoading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : activeTab === "issues" ? (
              openIssues.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
                  {issues.length === 0 ? "No issues reported for this vehicle." : "No open issues."}
                </div>
              ) : (
                <ul className="space-y-2">
                  {openIssues.map((issue) => (
                    <li key={issue.id} className="rounded-lg border border-gray-200 bg-white shadow-sm">
                      <button
                        type="button"
                        onClick={() => setExpandedIssueId((prev) => (prev === issue.id ? null : issue.id))}
                        className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left"
                        aria-expanded={expandedIssueId === issue.id}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[issue.severity]}`}
                          >
                            {issue.severity}
                          </span>
                          <span className="truncate text-sm font-medium text-gray-900">{issue.title}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-3 text-xs text-gray-500">
                          <span>{formatDate(issue.reportedAt)}</span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">
                            {ISSUE_STATUS_LABELS[issue.status]}
                          </span>
                        </div>
                      </button>
                      {expandedIssueId === issue.id && (
                        <div className="border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
                          {issue.description || "No additional description provided."}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )
            ) : activeTab === "inspections" ? (
              inspections.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
                  No inspections recorded yet.
                </div>
              ) : (
                <ul className="space-y-2">
                  {inspections.map((inspection) => (
                    <li
                      key={inspection.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {formatDate(inspection.completedAt ?? inspection.startedAt)}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          Inspector: {userNames[inspection.inspectorUserId] ?? inspection.inspectorUserId}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${RESULT_STYLES[inspection.overallResult]}`}
                      >
                        {RESULT_LABELS[inspection.overallResult]}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : maintenance.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
                No maintenance records yet.
              </div>
            ) : (
              <ul className="space-y-2">
                {maintenance.map((record) => (
                  <li key={record.id} className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900">
                        {record.maintenanceType.replace(/_/g, " ")}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span>{formatDate(record.performedAt)}</span>
                        {record.cost != null && (
                          <span className="font-medium text-gray-700">${record.cost.toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                    {record.description && <p className="mt-1 text-sm text-gray-600">{record.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </Layout>
  );
}

function VehicleDetailFallback() {
  return (
    <Layout>
      <p className="text-sm text-gray-500">Loading…</p>
    </Layout>
  );
}

export default function VehiclePage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<VehicleDetailFallback />}>
      <VehicleDetailPage params={props.params} />
    </Suspense>
  );
}
