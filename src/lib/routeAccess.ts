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

export const ROUTE_ROLES: { fleet: UserRole[] } = {
  fleet: ["admin", "fleet_manager", "supervisor"],
};
