/**
 * Which roles can access each role-gated route. Single source of truth —
 * read by both the page itself (via `useRequireRole`) and `Layout` (to
 * decide whether to even show that route's nav link), so the two can
 * never drift apart. Add an entry here whenever a new route needs
 * role-based access.
 *
 * This governs client-side UX only — see the warning on
 * `useRequireRole` for what still needs enforcing server-side.
 */
import type { UserRole } from "@/types";

export const ROUTE_ROLES: {
  fleet: UserRole[];
  workOrders: UserRole[];
  vehicleManagement: UserRole[];
  templates: UserRole[];
  users: UserRole[];
  admin: UserRole[];
  orgSettings: UserRole[];
} = {
  fleet: ["admin", "fleet_manager", "supervisor"],
  // Same role set as fleet today (and matches the workOrders/issues-update
  // Firestore write rules), but kept as its own entry rather than reusing
  // `fleet` — these are conceptually different pages that could diverge
  // later (e.g. equipment_manager gaining work order access without
  // gaining /fleet access).
  workOrders: ["admin", "fleet_manager", "supervisor"],
  // Narrower than `fleet` — supervisor can view the fleet list but not
  // add/edit/retire/reassign vehicles. Matches the vehicles write rule in
  // firestore.rules exactly. Gates /vehicle/new, /vehicle/[id]/edit, and
  // the management controls (Edit link, Reassign, Retire, manual status
  // override) shown inline on /fleet and the vehicle detail page.
  vehicleManagement: ["admin", "fleet_manager"],
  // Matches the inspectionTemplates write rule in firestore.rules exactly
  // (admin only — not even fleet_manager). Gates /admin/templates and its
  // new/edit subroutes.
  templates: ["admin"],
  // Admin only — matches who assertActiveOrgAdmin (functions/src/index.ts)
  // actually lets call inviteOrgUser/changeOrgUserRole/deactivateOrgUser/
  // reactivateOrgUser. Gates /admin/users and its invite subroute.
  users: ["admin"],
  // The admin home hub (/admin) — links to Users/Templates/Fleet/Settings
  // with org-wide counts. Also where landingPathForRole sends an admin
  // right after sign-in.
  admin: ["admin"],
  // Matches the organizations/{orgId} update rule in firestore.rules
  // exactly. Gates /admin/settings.
  orgSettings: ["admin"],
};

/**
 * Where a signed-in user lands right after authenticating (or on
 * visiting `/` while already signed in) — role-aware, since "My
 * Vehicles" (/dashboard) is an officer's view and isn't where a
 * fleet_manager/supervisor/admin wants to end up. Falls back to
 * /dashboard for every role not explicitly routed elsewhere
 * (officer, equipment_manager, readonly) — it's open to any
 * authenticated user regardless of role (see useRequireRole's callers).
 */
export function landingPathForRole(role: UserRole | null | undefined): string {
  if (role === "admin") {
    return "/admin";
  }
  if (role === "fleet_manager" || role === "supervisor") {
    return "/fleet";
  }
  return "/dashboard";
}
