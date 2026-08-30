"use client";

/**
 * Inspection form: starts an inspection for the vehicle given in
 * ?vehicleId=..., renders its template's checklist, and completes the
 * inspection on submit.
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
  uploadInspectionPhoto,
  type InspectionItemInput,
} from "@/services/inspectionService";
import type { InspectionTemplate, Vehicle } from "@/types";

/** The demo daily inspection template — see scripts/setup-demo.ts. */
const TEMPLATE_ID = "template-1";

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

  const allAnswered =
    template?.items.every((item) => {
      const answer = answers[item.id];
      if (!answer || answer.passed === null) {
        return false;
      }
      if (item.requiresPhoto && !answer.photoId) {
        return false;
      }
      if (item.requiresNote && !answer.textValue.trim()) {
        return false;
      }
      return true;
    }) ?? false;

  async function handleSubmit() {
    if (!user || !inspectionId || !template) {
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

                    {item.requiresNote && (
                      <div className="mt-3">
                        <label
                          htmlFor={`note-${item.id}`}
                          className="mb-1 block text-xs font-medium text-gray-500"
                        >
                          Note (required)
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
                    )}

                    {item.requiresPhoto && (
                      <div className="mt-3">
                        <label
                          htmlFor={`photo-${item.id}`}
                          className="mb-1 block text-xs font-medium text-gray-500"
                        >
                          Photo (required)
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
