"use client";

/**
 * Officer's landing page after sign-in: lists the vehicles currently
 * assigned to them, with a per-vehicle "Start Inspection" action.
 * Redirects to /auth/login if no one is signed in.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { listVehicles } from "@/services/vehicleService";
import type { AssetStatus, Vehicle } from "@/types";

const STATUS_STYLES: Record<AssetStatus, string> = {
  ready: "bg-green-100 text-green-800",
  attention: "bg-yellow-100 text-yellow-800",
  maintenance_required: "bg-orange-100 text-orange-800",
  out_of_service: "bg-red-100 text-red-800",
  retired: "bg-gray-200 text-gray-600",
  unknown: "bg-gray-100 text-gray-500",
};

const STATUS_LABELS: Record<AssetStatus, string> = {
  ready: "Ready",
  attention: "Attention",
  maintenance_required: "Maintenance Required",
  out_of_service: "Out of Service",
  retired: "Retired",
  unknown: "Unknown",
};

export default function DashboardPage() {
  const router = useRouter();
  const { user, firebaseUser, loading: authLoading, error: authError } = useAuth();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect once auth state has resolved and no one is signed in.
  useEffect(() => {
    if (!authLoading && !firebaseUser) {
      router.replace("/auth/login");
    }
  }, [authLoading, firebaseUser, router]);

  // Fetch vehicles assigned to the current officer once their profile loads.
  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;

    async function fetchAssignedVehicles(currentUser: NonNullable<typeof user>) {
      setVehiclesLoading(true);
      setError(null);
      try {
        const result = await listVehicles(currentUser.organizationId, {
          assignedUserId: currentUser.id,
        });
        if (!cancelled) {
          setVehicles(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load vehicles.");
        }
      } finally {
        if (!cancelled) {
          setVehiclesLoading(false);
        }
      }
    }

    fetchAssignedVehicles(user);

    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleStartInspection = (vehicleId: string) => {
    router.push(`/inspections/new?vehicleId=${vehicleId}`);
  };

  const isResolvingAuth = authLoading || !firebaseUser;

  return (
    <Layout>
      {isResolvingAuth ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">My Vehicles</h1>
            <p className="mt-1 text-sm text-gray-500">
              {user
                ? `Assigned to ${user.firstName} ${user.lastName}`
                : authError
                  ? "We couldn't load your profile — see console for details."
                  : "No profile found for your account. Contact your administrator."}
            </p>
          </div>

          {authError && (
            <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {authError.message}
            </p>
          )}

          {error && (
            <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {!user ? null : vehiclesLoading ? (
            <p className="text-sm text-gray-500">Loading vehicles…</p>
          ) : vehicles.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              No vehicles are currently assigned to you.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {vehicles.map((vehicle) => (
                <div
                  key={vehicle.id}
                  className="flex flex-col justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-base font-semibold text-gray-900">{vehicle.unitNumber}</h2>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[vehicle.status]}`}
                      >
                        {STATUS_LABELS[vehicle.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"}
                    </p>
                    {vehicle.licensePlate && (
                      <p className="mt-1 text-xs text-gray-400">Plate: {vehicle.licensePlate}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleStartInspection(vehicle.id)}
                    className="mt-4 w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    Start Inspection
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
