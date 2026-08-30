"use client";

/**
 * Inspection template list: one row per lineage (the latest version of
 * each — see listLatestTemplates), with its active/inactive state and
 * quick Activate/Deactivate.
 *
 * Gated to ROUTE_ROLES.templates (admin only) — matches the
 * inspectionTemplates write rule in firestore.rules exactly. Note for
 * testing: an admin account is required — a fleet_manager (e.g. Chen)
 * will pass this UI's client-side gate only if their role happens to be
 * "admin"; the actual write is denied server-side by the Firestore rule
 * regardless, which this app deliberately does not loosen (see
 * inspectionTemplateService.ts).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import AccessDenied from "@/components/AccessDenied";
import Layout from "@/components/Layout";
import { ROUTE_ROLES } from "@/lib/routeAccess";
import { useRequireRole } from "@/hooks/useRequireRole";
import { activateTemplate, deactivateTemplate, listLatestTemplates } from "@/services/inspectionTemplateService";
import type { AssetType, InspectionTemplate } from "@/types";

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  vehicle: "Vehicle",
  equipment: "Equipment",
};

export default function TemplatesPage() {
  const { status, user } = useRequireRole(ROUTE_ROLES.templates);

  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Pure data fetch, no setState — shared by the mount-time load (below)
  // and the manual reload after toggling active state, which each need
  // to wrap their own setState calls around it differently (one guards
  // against an unmounted/re-run effect, the other doesn't need to).
  async function fetchTemplates(orgId: string): Promise<InspectionTemplate[]> {
    const results = await listLatestTemplates(orgId);
    return results
      .slice()
      .sort((a, b) => a.appliesTo.localeCompare(b.appliesTo) || a.name.localeCompare(b.name));
  }

  useEffect(() => {
    if (status !== "allowed" || !user) {
      return;
    }
    let cancelled = false;

    async function load(orgId: string) {
      setLoadingTemplates(true);
      setError(null);
      try {
        const results = await fetchTemplates(orgId);
        if (!cancelled) {
          setTemplates(results);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load templates.");
        }
      } finally {
        if (!cancelled) {
          setLoadingTemplates(false);
        }
      }
    }

    load(user.organizationId);
    return () => {
      cancelled = true;
    };
  }, [status, user]);

  async function handleToggleActive(template: InspectionTemplate) {
    if (!user) {
      return;
    }
    setTogglingId(template.id);
    setError(null);
    try {
      if (template.isActive) {
        await deactivateTemplate(user.organizationId, template.id);
      } else {
        await activateTemplate(user.organizationId, template.id);
      }
      setTemplates(await fetchTemplates(user.organizationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update template.");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <Layout>
      {status === "loading" ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : status === "denied" ? (
        <AccessDenied requiredRoles={ROUTE_ROLES.templates} />
      ) : (
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Inspection Templates</h1>
              <p className="mt-1 text-sm text-gray-500">
                Only one template per asset type can be active — that&apos;s the one offered when starting a new
                inspection.
              </p>
            </div>
            <Link
              href="/admin/templates/new"
              className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              + New Template
            </Link>
          </div>

          {error && (
            <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {loadingTemplates ? (
            <p className="text-sm text-gray-500">Loading templates…</p>
          ) : templates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              No templates yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Applies To</th>
                    <th className="px-4 py-3">Version</th>
                    <th className="px-4 py-3">Items</th>
                    <th className="px-4 py-3">Recurrence</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {templates.map((template) => (
                    <tr key={template.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <Link
                          href={`/admin/templates/${template.id}/edit`}
                          className="hover:text-blue-700 hover:underline"
                        >
                          {template.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{ASSET_TYPE_LABELS[template.appliesTo]}</td>
                      <td className="px-4 py-3 text-gray-600">v{template.version}</td>
                      <td className="px-4 py-3 text-gray-600">{template.items.length}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {template.recurrenceDays ? `Every ${template.recurrenceDays}d` : "Ad hoc"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            template.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {template.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(template)}
                          disabled={togglingId === template.id}
                          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            template.isActive
                              ? "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                              : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                          }`}
                        >
                          {togglingId === template.id ? "Working…" : template.isActive ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
