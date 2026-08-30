"use client";

/**
 * Inspection form: starts an inspection for the vehicle given in
 * ?vehicleId=..., renders its template's checklist plus an optional
 * "Body Damage" section, and completes the inspection on submit.
 *
 * Wrapped in <Suspense> because `useSearchParams` requires it for static
 * builds (see Next.js docs on useSearchParams + prerendering) — otherwise
 * `next build` fails outright rather than just warning.
 */
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { getVehicle } from "@/services/vehicleService";
import {
  completeInspection,
  getInspectionTemplate,
  startInspection,
  submitDefect,
  uploadDefectPhoto,
  uploadInspectionPhoto,
  type InspectionItemInput,
} from "@/services/inspectionService";
import type { InspectionTemplate, IssueSeverity, Vehicle } from "@/types";

/** The demo daily inspection template — see scripts/setup-demo.ts. */
const TEMPLATE_ID = "template-1";

/**
 * Which checklist items show a photo control at all. Separate from
 * requiresPhoto (which would make a shown photo *mandatory* — see
 * allAnswered) — this is purely "does the control appear", hardcoded per
 * the current template's item ids the same way TEMPLATE_ID itself is.
 */
const PHOTO_VISIBLE_ITEM_IDS = new Set(["tires", "lights", "emergency-light"]);

const MAX_BODY_DAMAGE_PHOTOS = 3;
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png"];
const SEVERITY_OPTIONS: IssueSeverity[] = ["low", "medium", "high", "critical"];

interface ItemAnswer {
  passed: boolean | null;
  textValue: string;
  photoId: string | null;
  uploading: boolean;
}

function emptyAnswers(template: InspectionTemplate): Record<string, ItemAnswer> {
  return Object.fromEntries(
    template.items.map((item) => [item.id, { passed: null, textValue: "", photoId: null, uploading: false }])
  );
}

function InspectionFormPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const vehicleId = searchParams.get("vehicleId");

  const { user, firebaseUser, loading: authLoading } = useAuth();

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [template, setTemplate] = useState<InspectionTemplate | null>(null);
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, ItemAnswer>>({});
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Body Damage: entirely optional, separate from the checklist — see
  // handleSubmit's hasBodyDamage check and allAnswered below.
  const [bodyDamageDescription, setBodyDamageDescription] = useState("");
  const [bodyDamageSeverity, setBodyDamageSeverity] = useState<IssueSeverity>("low");
  const [bodyDamagePhotos, setBodyDamagePhotos] = useState<File[]>([]);
  const [bodyDamagePhotoPreviews, setBodyDamagePhotoPreviews] = useState<string[]>([]);
  const [bodyDamagePhotoError, setBodyDamagePhotoError] = useState<string | null>(null);

  // Redirect once auth state has resolved and no one is signed in.
  useEffect(() => {
    if (!authLoading && !firebaseUser) {
      router.replace("/auth/login");
    }
  }, [authLoading, firebaseUser, router]);

  // Load the vehicle + template and start the inspection once the
  // officer's profile and the target vehicle are both known.
  useEffect(() => {
    if (!user || !vehicleId) {
      return;
    }
    let cancelled = false;

    async function loadAndStart(currentUser: NonNullable<typeof user>, currentVehicleId: string) {
      setLoadingData(true);
      setLoadError(null);
      try {
        const [vehicleResult, templateResult] = await Promise.all([
          getVehicle(currentUser.organizationId, currentVehicleId),
          getInspectionTemplate(currentUser.organizationId, TEMPLATE_ID),
        ]);

        if (!vehicleResult) {
          throw new Error("Vehicle not found.");
        }
        if (!templateResult) {
          throw new Error("Inspection template not found.");
        }

        const newInspectionId = await startInspection(
          currentUser.organizationId,
          currentVehicleId,
          TEMPLATE_ID,
          currentUser.id
        );

        if (cancelled) {
          return;
        }
        setVehicle(vehicleResult);
        setTemplate(templateResult);
        setInspectionId(newInspectionId);
        setAnswers(emptyAnswers(templateResult));
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load inspection.");
        }
      } finally {
        if (!cancelled) {
          setLoadingData(false);
        }
      }
    }

    loadAndStart(user, vehicleId);

    return () => {
      cancelled = true;
    };
  }, [user, vehicleId]);

  function setAnswer(itemId: string, patch: Partial<ItemAnswer>) {
    setAnswers((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }

  async function handlePhotoChange(itemId: string, file: File | undefined) {
    if (!file || !user || !inspectionId) {
      return;
    }
    setAnswer(itemId, { uploading: true });
    try {
      const photoId = await uploadInspectionPhoto(user.organizationId, inspectionId, file);
      setAnswer(itemId, { photoId, uploading: false });
    } catch (err) {
      setAnswer(itemId, { uploading: false });
      setSubmitError(err instanceof Error ? err.message : "Failed to upload photo.");
    }
  }

  // Revoke Body Damage preview object URLs whenever they're replaced or
  // the page unmounts (same pattern as report-defect/page.tsx).
  useEffect(() => {
    return () => {
      bodyDamagePhotoPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [bodyDamagePhotoPreviews]);

  function handleBodyDamagePhotosChange(fileList: FileList | null) {
    if (!fileList) {
      return;
    }
    const files = Array.from(fileList);
    const valid = files.filter((file) => ALLOWED_PHOTO_TYPES.includes(file.type));
    const rejectedCount = files.length - valid.length;
    const kept = valid.slice(0, MAX_BODY_DAMAGE_PHOTOS);

    bodyDamagePhotoPreviews.forEach((url) => URL.revokeObjectURL(url));
    setBodyDamagePhotos(kept);
    setBodyDamagePhotoPreviews(kept.map((file) => URL.createObjectURL(file)));

    if (rejectedCount > 0) {
      setBodyDamagePhotoError(
        `${rejectedCount} file${rejectedCount === 1 ? "" : "s"} skipped — only .jpg/.png are allowed.`
      );
    } else if (valid.length > MAX_BODY_DAMAGE_PHOTOS) {
      setBodyDamagePhotoError(`Only the first ${MAX_BODY_DAMAGE_PHOTOS} photos were kept.`);
    } else {
      setBodyDamagePhotoError(null);
    }
  }

  function removeBodyDamagePhoto(index: number) {
    URL.revokeObjectURL(bodyDamagePhotoPreviews[index]);
    setBodyDamagePhotos((prev) => prev.filter((_, i) => i !== index));
    setBodyDamagePhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  // Every item just needs a pass/fail answer. requiresPhoto/requiresNote
  // stay on TemplateItem and are read nowhere in this gate on purpose —
  // notes and photos are never required for submission, full stop. The
  // fields themselves are kept in the schema (see src/types) for when a
  // department wants mandatory photo evidence on a specific item later;
  // wiring that back in is a deliberate future change, not an oversight.
  const allAnswered = template?.items.every((item) => answers[item.id]?.passed !== null) ?? false;

  async function handleSubmit() {
    if (!user || !inspectionId || !template || !vehicleId) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const items: InspectionItemInput[] = template.items.map((item) => {
        const answer = answers[item.id];
        return {
          templateItemId: item.id,
          itemLabel: item.label,
          passed: answer.passed ?? undefined,
          textValue: answer.textValue.trim() || undefined,
          photoIds: answer.photoId ? [answer.photoId] : undefined,
        };
      });

      await completeInspection(user.organizationId, inspectionId, items);

      // Body Damage is optional and separate from the checklist result —
      // only create an Issue if the officer actually reported something.
      const bodyDamageDescriptionTrimmed = bodyDamageDescription.trim();
      const hasBodyDamage = bodyDamageDescriptionTrimmed.length > 0 || bodyDamagePhotos.length > 0;
      if (hasBodyDamage) {
        const bodyDamagePhotoIds: string[] = [];
        for (const file of bodyDamagePhotos) {
          bodyDamagePhotoIds.push(await uploadDefectPhoto(user.organizationId, file));
        }
        // Same path report-defect/page.tsx uses: submitDefect creates the
        // Issue with reportedByUserId set to the officer's own id, which
        // is what the Firestore issues create rule requires.
        await submitDefect(
          user.organizationId,
          vehicleId,
          user.id,
          "Body Damage",
          bodyDamageDescriptionTrimmed,
          bodyDamageSeverity,
          bodyDamagePhotoIds
        );
      }

      router.push("/dashboard");
    } catch (err) {
      setSubmitting(false);
      setSubmitError(err instanceof Error ? err.message : "Failed to submit inspection.");
    }
  }

  const isResolvingAuth = authLoading || !firebaseUser;

  return (
    <Layout>
      {isResolvingAuth ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !vehicleId ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No vehicle specified.{" "}
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="font-medium text-blue-600 underline underline-offset-2"
          >
            Back to dashboard
          </button>
        </div>
      ) : loadingData ? (
        <p className="text-sm text-gray-500">Loading inspection…</p>
      ) : loadError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </p>
      ) : vehicle && template ? (
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h1 className="text-xl font-semibold text-gray-900">Unit {vehicle.unitNumber}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"}
            </p>
            <p className="mt-1 text-xs text-gray-400">{template.name}</p>
          </div>

          {submitError && (
            <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {submitError}
            </p>
          )}

          <div className="space-y-4">
            {template.items
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((item) => {
                const answer = answers[item.id];
                if (!answer) {
                  return null;
                }
                return (
                  <div key={item.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-sm font-semibold text-gray-900">{item.label}</h2>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => setAnswer(item.id, { passed: true })}
                          className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                            answer.passed === true
                              ? "bg-green-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-green-100"
                          }`}
                        >
                          Pass
                        </button>
                        <button
                          type="button"
                          onClick={() => setAnswer(item.id, { passed: false })}
                          className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                            answer.passed === false
                              ? "bg-red-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-red-100"
                          }`}
                        >
                          Fail
                        </button>
                      </div>
                    </div>

                    {/* Notes are available on every item — always optional
                        (see allAnswered above). */}
                    <div className="mt-3">
                      <label
                        htmlFor={`note-${item.id}`}
                        className="mb-1 block text-xs font-medium text-gray-500"
                      >
                        Note{item.requiresNote ? " (required)" : ""}
                      </label>
                      <textarea
                        id={`note-${item.id}`}
                        value={answer.textValue}
                        onChange={(event) => setAnswer(item.id, { textValue: event.target.value })}
                        rows={2}
                        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Add a note…"
                      />
                    </div>

                    {/* Photo control only on the items it's actually
                        relevant to — not every item gets one. */}
                    {PHOTO_VISIBLE_ITEM_IDS.has(item.id) && (
                      <div className="mt-3">
                        <label
                          htmlFor={`photo-${item.id}`}
                          className="mb-1 block text-xs font-medium text-gray-500"
                        >
                          Photo{item.requiresPhoto ? " (required)" : ""}
                        </label>
                        <input
                          id={`photo-${item.id}`}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(event) => handlePhotoChange(item.id, event.target.files?.[0])}
                          className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                        />
                        {answer.uploading && <p className="mt-1 text-xs text-gray-400">Uploading…</p>}
                        {answer.photoId && !answer.uploading && (
                          <p className="mt-1 text-xs text-green-600">Photo attached.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Body Damage — optional, separate from the checklist. Filling
              it in creates an Issue on submit via the same submitDefect
              path report-defect/page.tsx uses; leaving it blank creates
              nothing and doesn't affect the inspection result. */}
          <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Body Damage</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Optional — only fill this in if there&apos;s damage to report.
            </p>

            <div className="mt-3">
              <label
                htmlFor="body-damage-description"
                className="mb-1 block text-xs font-medium text-gray-500"
              >
                Description
              </label>
              <textarea
                id="body-damage-description"
                value={bodyDamageDescription}
                onChange={(event) => setBodyDamageDescription(event.target.value)}
                rows={3}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Describe any body damage…"
              />
            </div>

            <div className="mt-3">
              <label
                htmlFor="body-damage-severity"
                className="mb-1 block text-xs font-medium text-gray-500"
              >
                Severity
              </label>
              <select
                id="body-damage-severity"
                value={bodyDamageSeverity}
                onChange={(event) => setBodyDamageSeverity(event.target.value as IssueSeverity)}
                className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {SEVERITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3">
              <label htmlFor="body-damage-photos" className="mb-1 block text-xs font-medium text-gray-500">
                Photos (optional, up to {MAX_BODY_DAMAGE_PHOTOS})
              </label>
              <input
                id="body-damage-photos"
                type="file"
                accept="image/jpeg,image/png"
                multiple
                onChange={(event) => handleBodyDamagePhotosChange(event.target.files)}
                className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
              />
              {bodyDamagePhotoError && <p className="mt-1 text-xs text-red-600">{bodyDamagePhotoError}</p>}

              {bodyDamagePhotoPreviews.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {bodyDamagePhotoPreviews.map((url, index) => (
                    <div
                      key={url}
                      className="group relative aspect-square overflow-hidden rounded-md border border-gray-200"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, not an optimizable remote asset */}
                      <img src={url} alt={`Body damage photo ${index + 1}`} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeBodyDamagePhoto(index)}
                        aria-label={`Remove photo ${index + 1}`}
                        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold leading-none text-white hover:bg-black/80"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!allAnswered || submitting}
            className="mt-6 w-full rounded-md bg-blue-600 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {submitting ? "Submitting…" : "Submit Inspection"}
          </button>
        </div>
      ) : null}
    </Layout>
  );
}

function InspectionFormFallback() {
  return (
    <Layout>
      <p className="text-sm text-gray-500">Loading…</p>
    </Layout>
  );
}

export default function NewInspectionPage() {
  return (
    <Suspense fallback={<InspectionFormFallback />}>
      <InspectionFormPage />
    </Suspense>
  );
}
