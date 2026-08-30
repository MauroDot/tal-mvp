"use client";

/**
 * Fleet manager dashboard: every vehicle in the org (not just the current
 * user's assignments), a click-to-filter status summary, and a search box.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import StatusBadge from "@/components/StatusBadge";
import { formatDate } from "@/lib/dateUtils";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/services/organizationService";
import { getLatestCompletedInspection, getVehicleIssues, listVehicles } from "@/services/vehicleService";
import { OPEN_ISSUE_STATUSES } from "@/types";
import type { AssetStatus, Vehicle } from "@/types";

/** The statuses given a summary tile — "retired" deliberately has none (see summary). */
const SUMMARY_STATUSES: AssetStatus[] = ["out_of_service", "maintenance_required", "attention", "unknown", "ready"];

const STATUS_LABELS: Record<AssetStatus, string> = {
  ready: "Ready",
  attention: "Attention",
  maintenance_required: "Maintenance Required",
  out_of_service: "Out of Service",
  retired: "Retired",
  unknown: "Unknown",
};

// Worst-first: matches both the summary tile order and the list's sort
// order below, so the whole page reads consistently "worse -> better".
// "retired" sorts last — it's outside the active fleet lifecycle, not a
// problem this dashboard is meant to surface.
const STATUS_SORT_ORDER: Record<AssetStatus, number> = {
  out_of_service: 0,
  maintenance_required: 1,
  attention: 2,
  unknown: 3,
  ready: 4,
  retired: 5,
};

const STATUS_TILE_STYLES: Record<AssetStatus, string> = {
  ready: "border-green-500 bg-green-50",
  attention: "border-yellow-500 bg-yellow-50",
  maintenance_required: "border-orange-500 bg-orange-50",
  out_of_service: "border-red-500 bg-red-50",
  retired: "border-gray-400 bg-gray-100",
  unknown: "border-gray-400 bg-gray-100",
};

interface VehicleRowDetail {
  officerName: string | null;
  lastInspectionDate: string | null;
  openIssueCount: number;
}

export default function FleetPage() {
  const router = useRouter();
  const { user, firebaseUser, loading: authLoading } = useAuth();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [rowDetails, setRowDetails] = useState<Record<string, VehicleRowDetail>>({});
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<AssetStatus | null>(null);
  const [search, setSearch] = useState("");

  // Redirect once auth state has resolved and no one is signed in.
  useEffect(() => {
    if (!authLoading && !firebaseUser) {
      router.replace("/auth/login");
    }
  }, [authLoading, firebaseUser, router]);

  // Load every vehicle in the org, then enrich each row (officer name,
  // last completed inspection, open issue count) in a second pass.
  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;

    async function loadFleet(currentUser: NonNullable<typeof user>) {
      setLoadingVehicles(true);
      setError(null);

      let vehicleResults: Vehicle[];
      try {
        vehicleResults = await listVehicles(currentUser.organizationId);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load fleet.");
          setLoadingVehicles(false);
        }
        return;
      }
      if (cancelled) {
        return;
      }
      setVehicles(vehicleResults);
      setLoadingVehicles(false);

      try {
        // Resolve each distinct assigned officer's name once, even when
        // several vehicles share the same officer.
        const officerIds = Array.from(
          new Set(vehicleResults.map((v) => v.assignedUserId).filter((id): id is string => Boolean(id)))
        );
        const officerNameEntries = await Promise.all(
          officerIds.map(async (uid) => {
            try {
              const profile = await getUserProfile(currentUser.organizationId, uid);
              return [uid, profile ? `${profile.firstName} ${profile.lastName}` : null] as const;
            } catch {
              return [uid, null] as const;
            }
          })
        );
        const officerNames = Object.fromEntries(officerNameEntries);

        const detailEntries = await Promise.all(
          vehicleResults.map(async (vehicle) => {
            const [issuesResult, latestInspection] = await Promise.all([
              getVehicleIssues(currentUser.organizationId, vehicle.id),
              getLatestCompletedInspection(currentUser.organizationId, vehicle.id),
            ]);
            const openIssueCount = issuesResult.filter((issue) =>
              OPEN_ISSUE_STATUSES.includes(issue.status)
            ).length;
            const detail: VehicleRowDetail = {
              officerName: vehicle.assignedUserId ? (officerNames[vehicle.assignedUserId] ?? null) : null,
              lastInspectionDate: latestInspection?.completedAt ?? latestInspection?.startedAt ?? null,
              openIssueCount,
            };
            return [vehicle.id, detail] as const;
          })
        );

        if (!cancelled) {
          setRowDetails(Object.fromEntries(detailEntries));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load vehicle details.");
        }
      }
    }

    loadFleet(user);
    return () => {
      cancelled = true;
    };
  }, [user]);

  const statusCounts = useMemo(() => {
    const counts: Partial<Record<AssetStatus, number>> = {};
    for (const vehicle of vehicles) {
      counts[vehicle.status] = (counts[vehicle.status] ?? 0) + 1;
    }
    return counts;
  }, [vehicles]);

  const visibleVehicles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles
      .filter((v) => !statusFilter || v.status === statusFilter)
      .filter((v) => !q || v.unitNumber.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]);
  }, [vehicles, statusFilter, search]);

  const isResolvingAuth = authLoading || !firebaseUser;

  return (
    <Layout>
      {isResolvingAuth ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="mx-auto max-w-6xl">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Fleet</h1>
            <p className="mt-1 text-sm text-gray-500">All vehicles in your organization.</p>
          </div>

          {error && (
            <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {loadingVehicles ? (
            <p className="text-sm text-gray-500">Loading fleet…</p>
          ) : (
            <>
              {/* Status summary — click a tile to filter, click it again to clear. */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {SUMMARY_STATUSES.map((status) => {
                  const isActive = statusFilter === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setStatusFilter((prev) => (prev === status ? null : status))}
                      className={`rounded-lg border-2 px-4 py-3 text-left transition-colors ${
                        isActive ? STATUS_TILE_STYLES[status] : "border-gray-200 bg-white hover:bg-gray-50"
                      }`}
                    >
                      <div className="text-2xl font-bold text-gray-900">{statusCounts[status] ?? 0}</div>
                      <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                        {STATUS_LABELS[status]}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Search + active filter indicator */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by unit number…"
                  className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {statusFilter && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter(null)}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                  >
                    {STATUS_LABELS[statusFilter]}
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </div>

              {/* Vehicle list */}
              <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                {visibleVehicles.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-500">
                    {vehicles.length === 0 ? "No vehicles in this organization yet." : "No vehicles match this filter."}
                  </div>
                ) : (
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-3">Unit</th>
                        <th className="px-4 py-3">Make / Model</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Assigned Officer</th>
                        <th className="px-4 py-3">Last Inspection</th>
                        <th className="px-4 py-3">Open Issues</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {visibleVehicles.map((vehicle) => {
                        const detail = rowDetails[vehicle.id];
                        return (
                          <tr
                            key={vehicle.id}
                            onClick={() => router.push(`/vehicle/${vehicle.id}`)}
                            className="cursor-pointer hover:bg-gray-50"
                          >
                            <td className="px-4 py-3 font-medium text-gray-900">
                              <Link
                                href={`/vehicle/${vehicle.id}`}
                                onClick={(event) => event.stopPropagation()}
                                className="hover:text-blue-700 hover:underline"
                              >
                                {vehicle.unitNumber}
                              </Link>
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"}
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={vehicle.status} />
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {!detail ? "…" : (detail.officerName ?? "Unassigned")}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {!detail ? "…" : formatDate(detail.lastInspectionDate ?? undefined)}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {!detail ? "…" : detail.openIssueCount}
                            </td>
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
