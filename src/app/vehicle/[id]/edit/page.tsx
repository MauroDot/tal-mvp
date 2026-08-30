"use client";

/**
 * Edit Vehicle: same fields Add Vehicle collects (unit number, year,
 * make, model, VIN, odometer, assigned officer), pre-filled from the
 * current record. Odometer edits are monotonic — see updateVehicle's
 * doc comment; a rejected (lower) value is surfaced here, not silently
 * dropped.
 *
 * Gated to ROUTE_ROLES.vehicleManagement (admin/fleet_manager).
 *
 * Wrapped in <Suspense> because dynamic route `params` is a Promise in
 * this Next.js version, unwrapped via React's `use()` — same reasoning
 * as vehicle/[id]/page.tsx.
 */
import { Suspense, use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import Layout from "@/components/Layout";
import { ROUTE_ROLES } from "@/lib/routeAccess";
import { useRequireRole } from "@/hooks/useRequireRole";
import { listUsers } from "@/services/organizationService";
import { getVehicle, updateVehicle } from "@/services/vehicleService";
import type { User, Vehicle } from "@/types";

function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: vehicleId } = use(params);
  const router = useRouter();
  const { status: authStatus, user } = useRequireRole(ROUTE_ROLES.vehicleManagement);

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [orgUsers, setOrgUsers] = useState<User[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [unitNumber, setUnitNumber] = useState("");
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [vin, setVin] = useState("");
  const [odometer, setOdometer] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [odometerNotice, setOdometerNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;

    async function load(currentUser: NonNullable<typeof user>) {
      setLoadingData(true);
      setLoadError(null);
      try {
        const [vehicleResult, orgUsersResult] = await Promise.all([
          getVehicle(currentUser.organizationId, vehicleId),
          listUsers(currentUser.organizationId),
        ]);
        if (cancelled) {
          return;
        }
        if (!vehicleResult) {
          throw new Error("Vehicle not found.");
        }
        setVehicle(vehicleResult);
        setOrgUsers(orgUsersResult);
        setUnitNumber(vehicleResult.unitNumber);
        setYear(vehicleResult.year != null ? String(vehicleResult.year) : "");
        setMake(vehicleResult.make ?? "");
        setModel(vehicleResult.model ?? "");
        setVin(vehicleResult.vin ?? "");
        setOdometer(vehicleResult.odometer != null ? String(vehicleResult.odometer) : "");
        setAssignedUserId(vehicleResult.assignedUserId ?? "");
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load vehicle.");
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
  }, [user, vehicleId]);

  async function handleSubmit() {
    if (!user || !vehicle) {
      return;
    }
    if (!unitNumber.trim()) {
      setSubmitError("Unit number is required.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setOdometerNotice(null);
    try {
      const yearNum = year.trim() ? Number(year) : undefined;
      const odometerNum = odometer.trim() ? Number(odometer) : undefined;
      const result = await updateVehicle(
        user.organizationId,
        vehicle.id,
        {
          unitNumber,
          year: yearNum !== undefined && !Number.isNaN(yearNum) ? yearNum : undefined,
          make,
          model,
          vin,
          odometer: odometerNum !== undefined && !Number.isNaN(odometerNum) ? odometerNum : undefined,
          assignedUserId: assignedUserId || undefined,
        },
        user.id
      );
      if (result.odometerSkipped) {
        // A higher reading is already on file — stay on the page rather
        // than navigating away, so the notice is actually seen.
        setSubmitting(false);
        setOdometer(String(vehicle.odometer ?? ""));
        setOdometerNotice(
          `Odometer not updated — a higher reading (${vehicle.odometer?.toLocaleString()}) is already on file.`
        );
        return;
      }
      router.push(`/vehicle/${vehicle.id}`);
    } catch (err) {
      setSubmitting(false);
      setSubmitError(err instanceof Error ? err.message : "Failed to update vehicle.");
    }
  }

  const isResolvingAuth = authStatus === "loading";

  return (
    <Layout>
      {isResolvingAuth ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : authStatus === "denied" ? (
        <AccessDenied requiredRoles={ROUTE_ROLES.vehicleManagement} />
      ) : loadingData ? (
        <p className="text-sm text-gray-500">Loading vehicle…</p>
      ) : loadError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </p>
      ) : vehicle ? (
        <div className="mx-auto max-w-xl">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Edit Unit {vehicle.unitNumber}</h1>
          </div>

          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
            {submitError && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {submitError}
              </p>
            )}
            {odometerNotice && (
              <p role="alert" className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
                {odometerNotice}
              </p>
            )}

            <div>
              <label htmlFor="unit-number" className="mb-1 block text-xs font-medium text-gray-500">
                Unit Number *
              </label>
              <input
                id="unit-number"
                type="text"
                value={unitNumber}
                onChange={(event) => setUnitNumber(event.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="year" className="mb-1 block text-xs font-medium text-gray-500">
                  Year
                </label>
                <input
                  id="year"
                  type="number"
                  inputMode="numeric"
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="make" className="mb-1 block text-xs font-medium text-gray-500">
                  Make
                </label>
                <input
                  id="make"
                  type="text"
                  value={make}
                  onChange={(event) => setMake(event.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="model" className="mb-1 block text-xs font-medium text-gray-500">
                  Model
                </label>
                <input
                  id="model"
                  type="text"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="vin" className="mb-1 block text-xs font-medium text-gray-500">
                  VIN
                </label>
                <input
                  id="vin"
                  type="text"
                  value={vin}
                  onChange={(event) => setVin(event.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="odometer" className="mb-1 block text-xs font-medium text-gray-500">
                  Odometer
                </label>
                <input
                  id="odometer"
                  type="number"
                  inputMode="numeric"
                  value={odometer}
                  onChange={(event) => setOdometer(event.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="assigned-officer" className="mb-1 block text-xs font-medium text-gray-500">
                Assigned Officer
              </label>
              <select
                id="assigned-officer"
                value={assignedUserId}
                onChange={(event) => setAssignedUserId(event.target.value)}
                className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Unassigned</option>
                {orgUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => router.push(`/vehicle/${vehicle.id}`)}
                disabled={submitting}
                className="rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !unitNumber.trim()}
                className="flex-1 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {submitting ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}

function EditVehicleFallback() {
  return (
    <Layout>
      <p className="text-sm text-gray-500">Loading…</p>
    </Layout>
  );
}

export default function VehicleEditPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<EditVehicleFallback />}>
      <EditVehiclePage params={props.params} />
    </Suspense>
  );
}
