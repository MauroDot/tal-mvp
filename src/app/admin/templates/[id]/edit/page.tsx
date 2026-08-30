"use client";

/**
 * Edit an inspection template — same fields New Template collects, plus
 * version history and activation.
 *
 * Saving never mutates this document: it creates a new version (see
 * inspectionTemplateService.updateTemplate) and redirects to it. Only
 * the *latest* version of a lineage can be edited or activated — an
 * older version renders read-only, with a link to the latest one. This
 * is what "editing must not retroactively change what a past inspection
 * recorded" actually means in the data model: a completed Inspection's
 * `templateId` points at one of these frozen documents by id, forever.
 *
 * Gated to ROUTE_ROLES.templates (admin only).
 *
 * Wrapped in <Suspense> because dynamic route `params` is a Promise in
 * this Next.js version, unwrapped via React's `use()` — same reasoning
 * as vehicle/[id]/page.tsx.
 */
import { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import Layout from "@/components/Layout";
import TemplateItemsEditor, { newEditableItem, type EditableTemplateItem } from "@/components/TemplateItemsEditor";
import { formatDate } from "@/lib/dateUtils";
import { ROUTE_ROLES } from "@/lib/routeAccess";
import { useRequireRole } from "@/hooks/useRequireRole";
import {
  activateTemplate,
  deactivateTemplate,
  getTemplate,
  listTemplateVersions,
  updateTemplate,
} from "@/services/inspectionTemplateService";
import type { AssetType, InspectionTemplate } from "@/types";

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  vehicle: "Vehicle",
  equipment: "Equipment",
};

function toEditableItems(template: InspectionTemplate): EditableTemplateItem[] {
  return template.items
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => ({
      key: crypto.randomUUID(),
      id: item.id,
      label: item.label,
      section: item.section ?? "",
      requiresPhoto: item.requiresPhoto,
      requiresNote: item.requiresNote,
    }));
}

function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: templateId } = use(params);
  const router = useRouter();
  const { status: authStatus, user } = useRequireRole(ROUTE_ROLES.templates);

  const [template, setTemplate] = useState<InspectionTemplate | null>(null);
  const [versions, setVersions] = useState<InspectionTemplate[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [recurrenceDays, setRecurrenceDays] = useState("");
  const [items, setItems] = useState<EditableTemplateItem[]>([newEditableItem()]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;

    async function load(currentUser: NonNullable<typeof user>) {
      setLoadingData(true);
      setLoadError(null);
      try {
        const templateResult = await getTemplate(currentUser.organizationId, templateId);
        if (cancelled) {
          return;
        }
        if (!templateResult) {
          throw new Error("Template not found.");
        }
        const versionsResult = await listTemplateVersions(currentUser.organizationId, templateResult.familyId);
        if (cancelled) {
          return;
        }
        setTemplate(templateResult);
        setVersions(versionsResult);
        setName(templateResult.name);
        setDescription(templateResult.description ?? "");
        setRecurrenceDays(templateResult.recurrenceDays != null ? String(templateResult.recurrenceDays) : "");
        setItems(toEditableItems(templateResult));
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load template.");
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
  }, [user, templateId]);

  const isLatest = versions.length > 0 && versions[0].id === templateId;

  const trimmedItems = items.map((item) => ({ ...item, label: item.label.trim() }));
  const canSubmit = name.trim().length > 0 && trimmedItems.length > 0 && trimmedItems.every((item) => item.label);

  async function handleSubmit() {
    if (!user || !template) {
      return;
    }
    if (!canSubmit) {
      setSubmitError("Name and a label on every item are required.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const recurrence = recurrenceDays.trim() ? Number(recurrenceDays) : undefined;
      const result = await updateTemplate(user.organizationId, template.id, {
        name,
        description,
        recurrenceDays: recurrence !== undefined && !Number.isNaN(recurrence) ? recurrence : undefined,
        items: trimmedItems.map((item) => ({
          id: item.id,
          label: item.label,
          section: item.section,
          requiresPhoto: item.requiresPhoto,
          requiresNote: item.requiresNote,
        })),
      });
      router.push(`/admin/templates/${result.newTemplateId}/edit`);
    } catch (err) {
      setSubmitting(false);
      setSubmitError(err instanceof Error ? err.message : "Failed to save changes.");
    }
  }

  async function handleToggleActive() {
    if (!user || !template) {
      return;
    }
    setToggling(true);
    setToggleError(null);
    try {
      if (template.isActive) {
        await deactivateTemplate(user.organizationId, template.id);
      } else {
        await activateTemplate(user.organizationId, template.id);
      }
      setTemplate({ ...template, isActive: !template.isActive });
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : "Failed to update status.");
    } finally {
      setToggling(false);
    }
  }

  const isResolvingAuth = authStatus === "loading";

  return (
    <Layout>
      {isResolvingAuth ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : authStatus === "denied" ? (
        <AccessDenied requiredRoles={ROUTE_ROLES.templates} />
      ) : loadingData ? (
        <p className="text-sm text-gray-500">Loading template…</p>
      ) : loadError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </p>
      ) : template ? (
        <div className="mx-auto max-w-2xl space-y-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">{template.name}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {ASSET_TYPE_LABELS[template.appliesTo]} · Version {template.version}
            </p>
          </div>

          {!isLatest && (
            <p className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              This is a past version — read only. The current version is{" "}
              <Link href={`/admin/templates/${versions[0].id}/edit`} className="font-medium underline">
                v{versions[0].version}
              </Link>
              .
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                template.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
              }`}
            >
              {template.isActive ? "Active" : "Inactive"}
            </span>
            {isLatest && (
              <button
                type="button"
                onClick={handleToggleActive}
                disabled={toggling}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  template.isActive
                    ? "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                    : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                }`}
              >
                {toggling ? "Working…" : template.isActive ? "Deactivate" : "Activate"}
              </button>
            )}
            {toggleError && <span className="text-xs text-red-600">{toggleError}</span>}
          </div>

          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
            {submitError && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {submitError}
              </p>
            )}

            <div>
              <label htmlFor="name" className="mb-1 block text-xs font-medium text-gray-500">
                Name *
              </label>
              <input
                id="name"
                type="text"
                value={name}
                disabled={!isLatest}
                onChange={(event) => setName(event.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>

            <div>
              <label htmlFor="description" className="mb-1 block text-xs font-medium text-gray-500">
                Description (optional)
              </label>
              <textarea
                id="description"
                value={description}
                disabled={!isLatest}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>

            <div>
              <label htmlFor="recurrence" className="mb-1 block text-xs font-medium text-gray-500">
                Recurrence (days, optional)
              </label>
              <input
                id="recurrence"
                type="number"
                inputMode="numeric"
                min={1}
                value={recurrenceDays}
                disabled={!isLatest}
                onChange={(event) => setRecurrenceDays(event.target.value)}
                placeholder="e.g. 1 for daily, 30 for monthly"
                className="block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Checklist Items</p>
              <TemplateItemsEditor items={items} onChange={setItems} disabled={!isLatest} />
            </div>

            {isLatest && (
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => router.push("/admin/templates")}
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
                  {submitting ? "Saving…" : `Save as v${template.version + 1}`}
                </button>
              </div>
            )}
          </div>

          {versions.length > 1 && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              <h2 className="text-sm font-semibold text-gray-900">Version History</h2>
              <ul className="mt-2 divide-y divide-gray-100">
                {versions.map((version) => (
                  <li key={version.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link
                      href={`/admin/templates/${version.id}/edit`}
                      className={`hover:underline ${version.id === templateId ? "font-semibold text-gray-900" : "text-blue-600"}`}
                    >
                      v{version.version}
                    </Link>
                    <span className="text-xs text-gray-500">{formatDate(version.createdAt)}</span>
                    {version.isActive && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                        Active
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </Layout>
  );
}

function EditTemplateFallback() {
  return (
    <Layout>
      <p className="text-sm text-gray-500">Loading…</p>
    </Layout>
  );
}

export default function TemplateEditPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<EditTemplateFallback />}>
      <EditTemplatePage params={props.params} />
    </Suspense>
  );
}
