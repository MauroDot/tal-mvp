"use client";

/**
 * Organization settings: name and inspection interval — the fields
 * organizationService.updateOrganization writes. A direct Firestore
 * write, not a Cloud Function (see updateOrganization's doc comment and
 * firestore.rules' organizations/{orgId} rule for why: this document
 * carries no permission/role data, so there's no privilege-escalation
 * concern the way there is for the users subcollection).
 *
 * Gated to ROUTE_ROLES.orgSettings (admin only).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import Layout from "@/components/Layout";
import { ROUTE_ROLES } from "@/lib/routeAccess";
import { useRequireRole } from "@/hooks/useRequireRole";
import { getOrganization, updateOrganization } from "@/services/organizationService";
import type { Organization } from "@/types";

const DEFAULT_INSPECTION_INTERVAL_DAYS = 7;

export default function OrgSettingsPage() {
  const router = useRouter();
  const { status, user } = useRequireRole(ROUTE_ROLES.orgSettings);

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loadingOrg, setLoadingOrg] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [inspectionIntervalDays, setInspectionIntervalDays] = useState(String(DEFAULT_INSPECTION_INTERVAL_DAYS));

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (status !== "allowed" || !user) {
      return;
    }
    let cancelled = false;

    async function load(orgId: string) {
      setLoadingOrg(true);
      setLoadError(null);
      try {
        const result = await getOrganization(orgId);
        if (cancelled) {
          return;
        }
        if (!result) {
          throw new Error("Organization not found.");
        }
        setOrganization(result);
        setName(result.name);
        setInspectionIntervalDays(
          String(result.settings?.inspectionIntervalDays ?? DEFAULT_INSPECTION_INTERVAL_DAYS)
        );
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load organization.");
        }
      } finally {
        if (!cancelled) {
          setLoadingOrg(false);
        }
      }
    }

    load(user.organizationId);
    return () => {
      cancelled = true;
    };
  }, [status, user]);

  const intervalNum = Number(inspectionIntervalDays);
  const canSubmit = name.trim().length > 0 && Number.isFinite(intervalNum) && intervalNum > 0;

  async function handleSubmit() {
    if (!user || !canSubmit) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setSaved(false);
    try {
      await updateOrganization(user.organizationId, { name, inspectionIntervalDays: intervalNum });
      setSaved(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Layout>
      {status === "loading" ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : status === "denied" ? (
        <AccessDenied requiredRoles={ROUTE_ROLES.orgSettings} />
      ) : loadingOrg ? (
        <p className="text-sm text-gray-500">Loading settings…</p>
      ) : loadError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </p>
      ) : organization ? (
        <div className="mx-auto max-w-xl">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Organization Settings</h1>
          </div>

          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
            {submitError && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {submitError}
              </p>
            )}
            {saved && (
              <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                Settings saved.
              </p>
            )}

            <div>
              <label htmlFor="org-name" className="mb-1 block text-xs font-medium text-gray-500">
                Organization Name *
              </label>
              <input
                id="org-name"
                type="text"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved(false);
                }}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">Shown in the header in place of generic branding.</p>
            </div>

            <div>
              <label htmlFor="inspection-interval" className="mb-1 block text-xs font-medium text-gray-500">
                Inspection Interval (days) *
              </label>
              <input
                id="inspection-interval"
                type="number"
                inputMode="numeric"
                min={1}
                value={inspectionIntervalDays}
                onChange={(event) => {
                  setInspectionIntervalDays(event.target.value);
                  setSaved(false);
                }}
                className="block w-full max-w-[160px] rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">
                How often assets are expected to be inspected, by default (e.g. 7 for weekly).
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => router.push("/admin")}
                disabled={submitting}
                className="rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !canSubmit}
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
