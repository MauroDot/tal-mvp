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

export const ROUTE_ROLES: { fleet: UserRole[]; workOrders: UserRole[] } = {
  fleet: ["admin", "fleet_manager", "supervisor"],
  // Same role set as fleet today (and matches the workOrders/issues-update
  // Firestore write rules), but kept as its own entry rather than reusing
  // `fleet` — these are conceptually different pages that could diverge
  // later (e.g. equipment_manager gaining work order access without
  // gaining /fleet access).
  workOrders: ["admin", "fleet_manager", "supervisor"],
};
