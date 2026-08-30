"use client";

/**
 * Invite a new user: email, first/last name, role. Calls
 * userManagementService.inviteUser, which calls the `inviteOrgUser`
 * Cloud Function (creates the Auth account + Firestore profile +
 * userOrgs doc + audit log, admin-only, server-verified) and then sends
 * the actual password-reset email via the client SDK — see that
 * function's doc comment for why it's a two-step call.
 *
 * Gated to ROUTE_ROLES.users (admin only).
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AccessDenied from "@/components/AccessDenied";
import Layout from "@/components/Layout";
import { ROUTE_ROLES } from "@/lib/routeAccess";
import { useRequireRole } from "@/hooks/useRequireRole";
import { inviteUser } from "@/services/userManagementService";
import type { UserRole } from "@/types";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  fleet_manager: "Fleet Manager",
  equipment_manager: "Equipment Manager",
  supervisor: "Supervisor",
  officer: "Officer",
  readonly: "Read-only",
};

const ALL_ROLES = Object.keys(ROLE_LABELS) as UserRole[];

export default function InviteUserPage() {
  const router = useRouter();
  const { status } = useRequireRole(ROUTE_ROLES.users);

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<UserRole>("officer");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && firstName.trim().length > 0 && lastName.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) {
      setSubmitError("Email, first name, and last name are all required.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await inviteUser({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role,
      });
      setInvitedEmail(result.email);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to invite user.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Layout>
      {status === "loading" ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : status === "denied" ? (
        <AccessDenied requiredRoles={ROUTE_ROLES.users} />
      ) : invitedEmail ? (
        <div className="mx-auto max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl" aria-hidden="true">
            ✓
          </div>
          <h1 className="mt-4 text-lg font-semibold text-gray-900">Invite sent</h1>
          <p className="mt-2 text-sm text-gray-500">
            {invitedEmail} can now sign in — a password-reset email was sent so they can set their own password.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Link
              href="/admin/users"
              className="rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Back to Users
            </Link>
            <button
              type="button"
              onClick={() => {
                setInvitedEmail(null);
                setEmail("");
                setFirstName("");
                setLastName("");
                setRole("officer");
              }}
              className="rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              Invite Another
            </button>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-xl">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Invite User</h1>
          </div>

          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
            {submitError && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {submitError}
              </p>
            )}

            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-medium text-gray-500">
                Email *
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="officer@tulsaexample.gov"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="first-name" className="mb-1 block text-xs font-medium text-gray-500">
                  First Name *
                </label>
                <input
                  id="first-name"
                  type="text"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="last-name" className="mb-1 block text-xs font-medium text-gray-500">
                  Last Name *
                </label>
                <input
                  id="last-name"
                  type="text"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="role" className="mb-1 block text-xs font-medium text-gray-500">
                Role
              </label>
              <select
                id="role"
                value={role}
                onChange={(event) => setRole(event.target.value as UserRole)}
                className="block w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => router.push("/admin/users")}
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
                {submitting ? "Inviting…" : "Send Invite"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
