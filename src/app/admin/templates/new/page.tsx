"use client";

/**
 * New inspection template — starts at version 1, inactive. Activate it
 * from the list page or the edit page once it's ready to be offered for
 * real inspections (see inspectionTemplateService.activateTemplate).
 *
 * Gated to ROUTE_ROLES.templates (admin only).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import Layout from "@/components/Layout";
import TemplateItemsEditor, { newEditableItem, type EditableTemplateItem } from "@/components/TemplateItemsEditor";
import { ROUTE_ROLES } from "@/lib/routeAccess";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createTemplate } from "@/services/inspectionTemplateService";
import type { AssetType } from "@/types";

export default function NewTemplatePage() {
  const router = useRouter();
  const { status, user } = useRequireRole(ROUTE_ROLES.templates);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [appliesTo, setAppliesTo] = useState<AssetType>("vehicle");
  const [recurrenceDays, setRecurrenceDays] = useState("");
  const [items, setItems] = useState<EditableTemplateItem[]>([newEditableItem()]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const trimmedItems = items.map((item) => ({ ...item, label: item.label.trim() }));
  const canSubmit = name.trim().length > 0 && trimmedItems.length > 0 && trimmedItems.every((item) => item.label);

  async function handleSubmit() {
    if (!user) {
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
      const newId = await createTemplate(user.organizationId, {
        name,
        description,
        appliesTo,
        recurrenceDays: recurrence !== undefined && !Number.isNaN(recurrence) ? recurrence : undefined,
        items: trimmedItems.map((item) => ({
          id: item.id,
          label: item.label,
          section: item.section,
          requiresPhoto: item.requiresPhoto,
          requiresNote: item.requiresNote,
        })),
      });
      router.push(`/admin/templates/${newId}/edit`);
    } catch (err) {
      setSubmitting(false);
      setSubmitError(err instanceof Error ? err.message : "Failed to create template.");
    }
  }

  return (
    <Layout>
      {status === "loading" ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : status === "denied" ? (
        <AccessDenied requiredRoles={ROUTE_ROLES.templates} />
      ) : (
        <div className="mx-auto max-w-2xl">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">New Inspection Template</h1>
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
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Daily Vehicle Inspection"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="description" className="mb-1 block text-xs font-medium text-gray-500">
                Description (optional)
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="applies-to" className="mb-1 block text-xs font-medium text-gray-500">
                  Applies To
                </label>
                <select
                  id="applies-to"
                  value={appliesTo}
                  onChange={(event) => setAppliesTo(event.target.value as AssetType)}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="vehicle">Vehicle</option>
                  <option value="equipment">Equipment</option>
                </select>
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
                  onChange={(event) => setRecurrenceDays(event.target.value)}
                  placeholder="e.g. 1 for daily, 30 for monthly"
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Checklist Items</p>
              <TemplateItemsEditor items={items} onChange={setItems} />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => router.push("/admin/templates")}
                disabled={submitting}
                className="rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !canSubmit}
                className="flex-1 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {submitting ? "Creating…" : "Create Template"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
