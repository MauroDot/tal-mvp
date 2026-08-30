"use client";

/**
 * Client-side route guard: redirects to /auth/login if signed out, and
 * reports "denied" if signed in but the user's role isn't one of
 * `allowedRoles` (omit `allowedRoles` — as /dashboard does — to allow any
 * authenticated role, i.e. "just require sign-in").
 *
 * ⚠️ THIS IS UX ONLY, NOT SECURITY. It hides content and redirects in the
 * browser, but does nothing to stop a signed-in user from opening
 * devtools and calling the Firestore SDK (or REST API) directly with
 * their own credentials, bypassing this hook entirely. An "officer"
 * account can currently read/write anything an authenticated user can —
 * e.g. list every vehicle in the org via `listVehicles`, exactly what
 * /fleet does — regardless of what this guard renders.
 *
 * The actual enforcement has to live in Firestore Security Rules: rules
 * on `organizations/{orgId}/vehicles` (and whatever else a role-gated
 * page reads — issues, inspections, maintenanceRecords) need to check the
 * requesting user's role — read from
 * `organizations/{orgId}/users/{request.auth.uid}` — before allowing
 * list/get, mirroring `ROUTE_ROLES` (src/lib/routeAccess.ts) rather than
 * just checking `request.auth != null`. No `firestore.rules` file exists
 * in this repo yet, so right now there is no server-side enforcement at
 * all — every collection is exactly as open as whatever the current
 * (default/console-configured) rules allow to any authenticated user.
 */
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./useAuth";
import type { UserRole } from "@/types";

export type RoleGuardStatus = "loading" | "denied" | "allowed";

interface UseRequireRoleResult {
  /**
   * "loading" while auth/profile are resolving (or briefly before an
   * unauthenticated redirect completes); "denied" once resolved but the
   * user's role isn't in `allowedRoles`; "allowed" once resolved and
   * permitted — only then is it safe to render the page's real content.
   */
  status: RoleGuardStatus;
  /** The signed-in user's profile (role, org, name), once loaded. */
  user: ReturnType<typeof useAuth>["user"];
  /** Pass-through of useAuth's own error (e.g. the profile fetch failed). */
  error: ReturnType<typeof useAuth>["error"];
}

export function useRequireRole(allowedRoles?: UserRole[]): UseRequireRoleResult {
  const router = useRouter();
  const { user, firebaseUser, loading, error } = useAuth();

  useEffect(() => {
    if (!loading && !firebaseUser) {
      router.replace("/auth/login");
    }
  }, [loading, firebaseUser, router]);

  const status: RoleGuardStatus = useMemo(() => {
    if (loading || !firebaseUser) {
      return "loading";
    }
    if (!allowedRoles) {
      return "allowed";
    }
    if (!user) {
      // Signed in, but we don't know their role yet — never grant access
      // on an unresolved profile.
      return "loading";
    }
    return allowedRoles.includes(user.role) ? "allowed" : "denied";
  }, [loading, firebaseUser, user, allowedRoles]);

  return { status, user, error };
}
