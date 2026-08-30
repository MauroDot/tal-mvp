"use client";

/**
 * Add Vehicle: unit number, year, make, model, VIN, odometer, and an
 * optional assigned officer (a real reference to an org user — a select,
 * not free text, unlike work orders' "Assigned To"). New vehicles always
 * start at status "unknown" (see addVehicle) — there's no status field
 * here for the same reason there's no status field on the edit form.
 *
 * Gated to ROUTE_ROLES.vehicleManagement (admin/fleet_manager), narrower
 * than the supervisor-inclusive ROUTE_ROLES.fleet that gates /fleet
 * itself — matches the vehicles write rule in firestore.rules exactly.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import Layout from "@/components/Layout";
import { ROUTE_ROLES } from "@/lib/routeAccess";
import { useRequireRole } from "@/hooks/useRequireRole";
import { listUsers } from "@/services/organizationService";
import { addVehicle } from "@/services/vehicleService";
import type { User } from "@/types";

export default function NewVehiclePage() {
  const router = useRouter();
  const { status, user } = useRequireRole(ROUTE_ROLES.vehicleManagement);

  const [orgUsers, setOrgUsers] = useState<User[]>([]);

  const [unitNumber, setUnitNumber] = useState("");
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [vin, setVin] = useState("");
  const [odometer, setOdometer] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "allowed" || !user) {
      return;
    }
    let cancelled = false;
    listUsers(user.organizationId)
      .then((results) => {
        if (!cancelled) {
          setOrgUsers(results);
        }
      })
      .catch(() => {
        // Non-fatal — the officer picker just falls back to "Unassigned" only.
      });
    return () => {
      cancelled = true;
    };
  }, [status, user]);

  async function handleSubmit() {
    if (!user) {
      return;
    }
    if (!unitNumber.trim()) {
      setSubmitError("Unit number is required.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const yearNum = year.trim() ? Number(year) : undefined;
      const odometerNum = odometer.trim() ? Number(odometer) : undefined;
      const newId = await addVehicle(
        user.organizationId,
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
      router.push(`/vehicle/${newId}`);
    } catch (err) {
      setSubmitting(false);
      setSubmitError(err instanceof Error ? err.message : "Failed to create vehicle.");
    }
  }

  return (
    <Layout>
      {status === "loading" ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : status === "denied" ? (
        <AccessDenied requiredRoles={ROUTE_ROLES.vehicleManagement} />
      ) : (
        <div className="mx-auto max-w-xl">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Add Vehicle</h1>
            <p className="mt-1 text-sm text-gray-500">
              New vehicles start with status &ldquo;Unknown&rdquo; until inspected.
            </p>
          </div>

          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
            {submitError && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {submitError}
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
                placeholder="e.g. T-104"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                onClick={() => router.push("/fleet")}
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
                {submitting ? "Creating…" : "Create Vehicle"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
