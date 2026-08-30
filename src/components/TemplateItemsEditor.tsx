"use client";

/**
 * Checklist item editor shared by the template create and edit forms —
 * add, remove, reorder (up/down — no drag-and-drop library), and rename
 * items, plus per-item requiresPhoto/requiresNote toggles. Everything
 * else a TemplateItem carries (responseType, isRequired,
 * autoCreateIssueOnFail, min/max/unit) isn't exposed here — out of scope
 * for this UI (see inspectionTemplateService.buildItems, which fills
 * those in with fixed defaults).
 */
import { useId } from "react";

/**
 * One row's editable state. `key` is a stable client-side identity for
 * React (and for this component's own reordering) — separate from `id`,
 * which is only present for a row that already exists in the version
 * being edited; a newly added row has no `id` yet (one is generated at
 * save time — see inspectionTemplateService.buildItems).
 */
export interface EditableTemplateItem {
  key: string;
  id?: string;
  label: string;
  section: string;
  requiresPhoto: boolean;
  requiresNote: boolean;
}

export function newEditableItem(): EditableTemplateItem {
  return {
    key: crypto.randomUUID(),
    label: "",
    section: "",
    requiresPhoto: false,
    requiresNote: false,
  };
}

interface TemplateItemsEditorProps {
  items: EditableTemplateItem[];
  onChange: (items: EditableTemplateItem[]) => void;
  /** Read-only rendering for a superseded version — see admin/templates/[id]/edit/page.tsx. */
  disabled?: boolean;
}

export default function TemplateItemsEditor({ items, onChange, disabled = false }: TemplateItemsEditorProps) {
  const baseId = useId();

  function updateItem(key: string, patch: Partial<EditableTemplateItem>) {
    onChange(items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function removeItem(key: string) {
    onChange(items.filter((item) => item.key !== key));
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) {
      return;
    }
    const next = items.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <p className="text-sm text-gray-500">No items yet — add at least one checklist item.</p>
      )}
      {items.map((item, index) => (
        <div key={item.key} className="rounded-md border border-gray-200 p-3">
          <div className="flex items-start gap-2">
            <div className="flex shrink-0 flex-col gap-0.5 pt-1">
              <button
                type="button"
                onClick={() => moveItem(index, -1)}
                disabled={disabled || index === 0}
                aria-label="Move item up"
                className="flex h-5 w-5 items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveItem(index, 1)}
                disabled={disabled || index === items.length - 1}
                aria-label="Move item down"
                className="flex h-5 w-5 items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
              >
                ↓
              </button>
            </div>

            <div className="min-w-0 flex-1 space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${baseId}-label-${item.key}`} className="mb-1 block text-xs font-medium text-gray-500">
                    Label
                  </label>
                  <input
                    id={`${baseId}-label-${item.key}`}
                    type="text"
                    value={item.label}
                    disabled={disabled}
                    onChange={(event) => updateItem(item.key, { label: event.target.value })}
                    placeholder="e.g. Check tire tread depth"
                    className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </div>
                <div>
                  <label htmlFor={`${baseId}-section-${item.key}`} className="mb-1 block text-xs font-medium text-gray-500">
                    Section (optional)
                  </label>
                  <input
                    id={`${baseId}-section-${item.key}`}
                    type="text"
                    value={item.section}
                    disabled={disabled}
                    onChange={(event) => updateItem(item.key, { section: event.target.value })}
                    placeholder="e.g. Brakes"
                    className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-1.5 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={item.requiresPhoto}
                    disabled={disabled}
                    onChange={(event) => updateItem(item.key, { requiresPhoto: event.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Requires photo
                </label>
                <label className="inline-flex items-center gap-1.5 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={item.requiresNote}
                    disabled={disabled}
                    onChange={(event) => updateItem(item.key, { requiresNote: event.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Requires note
                </label>
              </div>
            </div>

            <button
              type="button"
              onClick={() => removeItem(item.key)}
              disabled={disabled}
              aria-label={`Remove item ${item.label || index + 1}`}
              className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
            >
              Remove
            </button>
          </div>
        </div>
      ))}

      {!disabled && (
        <button
          type="button"
          onClick={() => onChange([...items, newEditableItem()])}
          className="rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-blue-400 hover:text-blue-700"
        >
          + Add Item
        </button>
      )}
    </div>
  );
}
