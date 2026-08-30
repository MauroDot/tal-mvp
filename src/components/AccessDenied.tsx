/**
 * Shown by a role-gated page when the signed-in user's role isn't
 * permitted — a clear, deliberate "you don't have access" state, not a
 * crash or a silently empty page.
 */
import Link from "next/link";
import type { UserRole } from "@/types";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  fleet_manager: "Fleet Manager",
  equipment_manager: "Equipment Manager",
  supervisor: "Supervisor",
  officer: "Officer",
  readonly: "Read-only",
};

interface AccessDeniedProps {
  /** Roles that *would* be allowed, shown to explain why access was denied. */
  requiredRoles?: UserRole[];
}

export default function AccessDenied({ requiredRoles }: AccessDeniedProps) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl" aria-hidden="true">
        🔒
      </div>
      <h1 className="mt-4 text-lg font-semibold text-gray-900">You don&apos;t have access</h1>
      <p className="mt-2 text-sm text-gray-500">
        {requiredRoles && requiredRoles.length > 0
          ? `This page is limited to: ${requiredRoles.map((role) => ROLE_LABELS[role]).join(", ")}.`
          : "You don't have permission to view this page."}
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-block rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
