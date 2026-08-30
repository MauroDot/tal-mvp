"use client";

/**
 * Standalone defect report form for a vehicle (not tied to any inspection).
 *
 * Wrapped in <Suspense> because dynamic route `params` is a Promise in
 * this Next.js version, unwrapped via React's `use()` — which suspends
 * the calling component, so it needs a Suspense boundary above it (same
 * reasoning as the useSearchParams() wrapper in inspections/new/page.tsx).
 */
import { Suspense, use, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { getVehicle } from "@/services/vehicleService";
import { submitDefect, uploadDefectPhoto } from "@/services/inspectionService";
import type { IssueSeverity, Vehicle } from "@/types";

const MAX_PHOTOS = 3;
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png"];
const SEVERITY_OPTIONS: IssueSeverity[] = ["low", "medium", "high", "critical"];

interface FieldErrors {
  title?: string;
  description?: string;
  severity?: string;
  photos?: string;
}

function ReportDefectForm({ params }: { params: Promise<{ id: string }> }) {
  const { id: vehicleId } = use(params);
  const router = useRouter();
  const { user, firebaseUser, loading: authLoading } = useAuth();

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loadingVehicle, setLoadingVehicle] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<IssueSeverity | "">("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Redirect once auth state has resolved and no one is signed in.
  useEffect(() => {
    if (!authLoading && !firebaseUser) {
      router.replace("/auth/login");
    }
  }, [authLoading, firebaseUser, router]);

  // Load the vehicle once the officer's profile is known.
  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;

    async function loadVehicle(currentUser: NonNullable<typeof user>) {
      setLoadingVehicle(true);
      setLoadError(null);
      try {
        const result = await getVehicle(currentUser.organizationId, vehicleId);
        if (cancelled) {
          return;
        }
        if (!result) {
          setLoadError("Vehicle not found.");
        } else {
          setVehicle(result);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load vehicle.");
        }
      } finally {
        if (!cancelled) {
          setLoadingVehicle(false);
        }
      }
    }

    loadVehicle(user);
    return () => {
      cancelled = true;
    };
  }, [user, vehicleId]);

  // Revoke preview object URLs whenever they're replaced or the page unmounts.
  useEffect(() => {
    return () => {
      photoPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [photoPreviews]);

  function handlePhotosChange(fileList: FileList | null) {
    if (!fileList) {
      return;
    }
    const files = Array.from(fileList);
    const valid = files.filter((file) => ALLOWED_PHOTO_TYPES.includes(file.type));
    const rejectedCount = files.length - valid.length;
    const kept = valid.slice(0, MAX_PHOTOS);

    photoPreviews.forEach((url) => URL.revokeObjectURL(url));
    setPhotos(kept);
    setPhotoPreviews(kept.map((file) => URL.createObjectURL(file)));

    if (rejectedCount > 0) {
      setFieldErrors((prev) => ({
        ...prev,
        photos: `${rejectedCount} file${rejectedCount === 1 ? "" : "s"} skipped — only .jpg/.png are allowed.`,
      }));
    } else if (valid.length > MAX_PHOTOS) {
      setFieldErrors((prev) => ({ ...prev, photos: `Only the first ${MAX_PHOTOS} photos were kept.` }));
    } else {
      setFieldErrors((prev) => ({ ...prev, photos: undefined }));
    }
  }

  function removePhoto(index: number) {
    URL.revokeObjectURL(photoPreviews[index]);
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  function validate(): boolean {
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const errors: FieldErrors = {};

    if (!trimmedTitle) {
      errors.title = "Title is required.";
    } else if (trimmedTitle.length > 100) {
      errors.title = "Title must be 100 characters or fewer.";
    }

    if (!trimmedDescription) {
      errors.description = "Description is required.";
    } else if (trimmedDescription.length < 10) {
      errors.description = "Description must be at least 10 characters.";
    }

    if (!severity) {
      errors.severity = "Select a severity.";
    }

    setFieldErrors((prev) => ({ ...prev, ...errors }));
    return !errors.title && !errors.description && !errors.severity;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !user) {
      return;
    }
    if (!validate()) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const photoIds: string[] = [];
      for (const file of photos) {
        photoIds.push(await uploadDefectPhoto(user.organizationId, file));
      }

      await submitDefect(
        user.organizationId,
        vehicleId,
        user.id,
        title.trim(),
        description.trim(),
        severity as IssueSeverity,
        photoIds
      );

      setSubmitSuccess(true);
      setTimeout(() => {
        router.push(`/vehicle/${vehicleId}`);
      }, 2000);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to report defect. Please try again.");
      setSubmitting(false);
    }
  }

  const isResolvingAuth = authLoading || !firebaseUser;
  const isCritical = severity === "critical";

  return (
    <Layout>
      {isResolvingAuth ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : loadingVehicle ? (
        <p className="text-sm text-gray-500">Loading vehicle…</p>
      ) : loadError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </p>
      ) : vehicle ? (
        <div className="mx-auto max-w-xl">
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h1 className="text-xl font-semibold text-gray-900">Report Defect — Unit {vehicle.unitNumber}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"}
            </p>
          </div>

          {submitSuccess ? (
            <div
              role="status"
              className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800"
            >
              Defect reported successfully. Redirecting…
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              noValidate
              className={`space-y-5 rounded-lg border bg-white p-4 shadow-sm sm:p-6 ${
                isCritical ? "border-red-400 ring-2 ring-red-100" : "border-gray-200"
              }`}
            >
              {submitError && (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {submitError}
                </p>
              )}

              {isCritical && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  This will be reported as a critical defect.
                </p>
              )}

              <div>
                <label htmlFor="title" className="mb-1 block text-sm font-medium text-gray-700">
                  Title
                </label>
                <input
                  id="title"
                  type="text"
                  value={title}
                  maxLength={100}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    if (fieldErrors.title) {
                      setFieldErrors((prev) => ({ ...prev, title: undefined }));
                    }
                  }}
                  className={`block w-full rounded-md border px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 ${
                    fieldErrors.title
                      ? "border-red-400 focus:ring-red-400"
                      : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  }`}
                  placeholder="e.g. Left rear tire low tread"
                />
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-xs text-red-600">{fieldErrors.title}</p>
                  <p className="shrink-0 pl-2 text-xs text-gray-400">{title.length}/100</p>
                </div>
              </div>

              <div>
                <label htmlFor="description" className="mb-1 block text-sm font-medium text-gray-700">
                  Description
                </label>
                <textarea
                  id="description"
                  rows={4}
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    if (fieldErrors.description) {
                      setFieldErrors((prev) => ({ ...prev, description: undefined }));
                    }
                  }}
                  className={`block w-full rounded-md border px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 ${
                    fieldErrors.description
                      ? "border-red-400 focus:ring-red-400"
                      : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  }`}
                  placeholder="Describe what's wrong and any relevant details…"
                />
                {fieldErrors.description && <p className="mt-1 text-xs text-red-600">{fieldErrors.description}</p>}
              </div>

              <div>
                <label htmlFor="severity" className="mb-1 block text-sm font-medium text-gray-700">
                  Severity
                </label>
                <select
                  id="severity"
                  value={severity}
                  onChange={(event) => {
                    setSeverity(event.target.value as IssueSeverity | "");
                    if (fieldErrors.severity) {
                      setFieldErrors((prev) => ({ ...prev, severity: undefined }));
                    }
                  }}
                  className={`block w-full rounded-md border bg-white px-4 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 ${
                    fieldErrors.severity
                      ? "border-red-400 focus:ring-red-400"
                      : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  }`}
                >
                  <option value="" disabled>
                    Select severity…
                  </option>
                  {SEVERITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option.charAt(0).toUpperCase() + option.slice(1)}
                    </option>
                  ))}
                </select>
                {fieldErrors.severity && <p className="mt-1 text-xs text-red-600">{fieldErrors.severity}</p>}
              </div>

              <div>
                <label htmlFor="photos" className="mb-1 block text-sm font-medium text-gray-700">
                  Photos (optional, up to {MAX_PHOTOS})
                </label>
                <input
                  id="photos"
                  type="file"
                  accept="image/jpeg,image/png"
                  multiple
                  onChange={(event) => handlePhotosChange(event.target.files)}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                />
                {fieldErrors.photos && <p className="mt-1 text-xs text-red-600">{fieldErrors.photos}</p>}

                {photoPreviews.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {photoPreviews.map((url, index) => (
                      <div
                        key={url}
                        className="group relative aspect-square overflow-hidden rounded-md border border-gray-200"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, not an optimizable remote asset */}
                        <img src={url} alt={`Selected photo ${index + 1}`} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removePhoto(index)}
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

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {submitting && (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                )}
                {submitting ? "Submitting…" : "Submit Report"}
              </button>
            </form>
          )}
        </div>
      ) : null}
    </Layout>
  );
}

function ReportDefectFallback() {
  return (
    <Layout>
      <p className="text-sm text-gray-500">Loading…</p>
    </Layout>
  );
}

export default function ReportDefectPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<ReportDefectFallback />}>
      <ReportDefectForm params={props.params} />
    </Suspense>
  );
}
