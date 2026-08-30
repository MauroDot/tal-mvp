"use client";

/**
 * User management: list every org user (name, email, role, active
 * state), change roles, deactivate/reactivate, and invite new ones.
 *
 * Every write here — role change, deactivate, reactivate — goes through
 * a Cloud Function (userManagementService.ts / functions/src/index.ts),
 * never a direct Firestore write: firestore.rules denies all client
 * writes to the users subcollection outright. Listing is a plain
 * Firestore read (organizationService.listUsers) — reads are allowed for
 * any org member.
 *
 * The two safeguards (can't change your own role; can't demote/
 * deactivate the org's last active admin) are enforced server-side in
 * the Cloud Functions regardless — the disabled buttons/selects here are
 * just so the UI doesn't invite an attempt that's guaranteed to be
 * rejected. If the client-side count and the server ever disagree (e.g.
 * another admin's change lands mid-session), the server's rejection
 * message is what's shown.
 *
 * Also flags orphaned profiles — a uid with no corresponding Firebase
 * Auth account, left over from a past seed/migration mistake (see
 * scripts/setup-demo.ts's --reset). checkOrphanedUsers is a separate
 * Cloud Function call (userManagementService.ts) because the client has
 * no way to check Auth-account existence for anyone but itself; if that
 * call fails, this page just doesn't show the flag rather than blocking
 * on it — orphan detection is a nice-to-have, not something the rest of
 * the page depends on.
 *
 * Gated to ROUTE_ROLES.users (admin only).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AccessDenied from "@/components/AccessDenied";
import Layout from "@/components/Layout";
import { ROUTE_ROLES } from "@/lib/routeAccess";
import { useRequireRole } from "@/hooks/useRequireRole";
import { listUsers } from "@/services/organizationService";
import {
  changeUserRole,
  checkOrphanedUsers,
  deactivateUser,
  reactivateUser,
} from "@/services/userManagementService";
import type { User, UserRole } from "@/types";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  fleet_manager: "Fleet Manager",
  equipment_manager: "Equipment Manager",
  supervisor: "Supervisor",
  officer: "Officer",
  readonly: "Read-only",
};

const ALL_ROLES = Object.keys(ROLE_LABELS) as UserRole[];

export default function UsersPage() {
  const { status, user: currentUser } = useRequireRole(ROUTE_ROLES.users);

  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [orphanedUids, setOrphanedUids] = useState<Set<string>>(new Set());

  async function fetchUsers(orgId: string): Promise<User[]> {
    return (await listUsers(orgId)).slice().sort((a, b) => a.firstName.localeCompare(b.firstName));
  }

  // Best-effort — a failure here just leaves nothing flagged, it
  // shouldn't block the page (see the file header comment).
  async function fetchOrphanedUids(): Promise<Set<string>> {
    try {
      return new Set(await checkOrphanedUsers());
    } catch (err) {
      console.error("[admin/users] checkOrphanedUsers failed — orphaned profiles won't be flagged", err);
      return new Set();
    }
  }

  useEffect(() => {
    if (status !== "allowed" || !currentUser) {
      return;
    }
    let cancelled = false;

    async function load(orgId: string) {
      setLoadingUsers(true);
      setLoadError(null);
      try {
        const results = await fetchUsers(orgId);
        if (!cancelled) {
          setUsers(results);
          setRoleDrafts(Object.fromEntries(results.map((u) => [u.id, u.role])));
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load users.");
        }
      } finally {
        if (!cancelled) {
          setLoadingUsers(false);
        }
      }

      const orphaned = await fetchOrphanedUids();
      if (!cancelled) {
        setOrphanedUids(orphaned);
      }
    }

    load(currentUser.organizationId);
    return () => {
      cancelled = true;
    };
  }, [status, currentUser]);

  // Only counts toward "last active admin" — matches
  // countOtherActiveAdmins in functions/src/index.ts, client-side, for
  // disabling controls preemptively.
  const activeAdminCount = useMemo(() => users.filter((u) => u.role === "admin" && u.isActive).length, [users]);

  async function reload(orgId: string) {
    const results = await fetchUsers(orgId);
    setUsers(results);
    setRoleDrafts(Object.fromEntries(results.map((u) => [u.id, u.role])));
  }

  async function handleSaveRole(targetUser: User) {
    if (!currentUser) {
      return;
    }
    const newRole = roleDrafts[targetUser.id];
    setBusyUid(targetUser.id);
    setRowErrors((prev) => ({ ...prev, [targetUser.id]: "" }));
    try {
      await changeUserRole(targetUser.id, newRole);
      await reload(currentUser.organizationId);
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [targetUser.id]: err instanceof Error ? err.message : "Failed to change role.",
      }));
      setRoleDrafts((prev) => ({ ...prev, [targetUser.id]: targetUser.role }));
    } finally {
      setBusyUid(null);
    }
  }

  async function handleToggleActive(targetUser: User) {
    if (!currentUser) {
      return;
    }
    setBusyUid(targetUser.id);
    setRowErrors((prev) => ({ ...prev, [targetUser.id]: "" }));
    try {
      if (targetUser.isActive) {
        await deactivateUser(targetUser.id);
      } else {
        await reactivateUser(targetUser.id);
      }
      await reload(currentUser.organizationId);
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [targetUser.id]: err instanceof Error ? err.message : "Failed to update user.",
      }));
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <Layout>
      {status === "loading" ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : status === "denied" ? (
        <AccessDenied requiredRoles={ROUTE_ROLES.users} />
      ) : (
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Users</h1>
              <p className="mt-1 text-sm text-gray-500">
                An admin can&apos;t change their own role, and the last active admin can&apos;t be demoted or
                deactivated.
              </p>
            </div>
            <Link
              href="/admin/users/invite"
              className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              + Invite User
            </Link>
          </div>

          {loadError && (
            <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {loadError}
            </p>
          )}

          {loadingUsers ? (
            <p className="text-sm text-gray-500">Loading users…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map((u) => {
                    const isSelf = currentUser?.id === u.id;
                    const isLastActiveAdmin = u.role === "admin" && u.isActive && activeAdminCount <= 1;
                    const roleChangeDisabled = isSelf || busyUid === u.id;
                    const isOrphaned = orphanedUids.has(u.id);
                    // Reactivating an orphaned profile always fails server-side
                    // (see reactivateOrgUser's auth/user-not-found handling) —
                    // don't offer the button at all rather than let an admin
                    // hit that error blind. Deactivating one is still fine
                    // (it's a harmless no-op on the Auth side either way).
                    const deactivateDisabled =
                      (u.isActive && isLastActiveAdmin) || (!u.isActive && isOrphaned) || busyUid === u.id;
                    const draftRole = roleDrafts[u.id] ?? u.role;

                    return (
                      <tr key={u.id} className="align-top hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {u.firstName} {u.lastName}
                          {isSelf && <span className="ml-1.5 text-xs font-normal text-gray-400">(you)</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{u.email}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <select
                              aria-label={`Role for ${u.firstName} ${u.lastName}`}
                              value={draftRole}
                              disabled={roleChangeDisabled}
                              onChange={(event) =>
                                setRoleDrafts((prev) => ({ ...prev, [u.id]: event.target.value as UserRole }))
                              }
                              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                            >
                              {ALL_ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {ROLE_LABELS[role]}
                                </option>
                              ))}
                            </select>
                            {!roleChangeDisabled && draftRole !== u.role && (
                              <button
                                type="button"
                                onClick={() => handleSaveRole(u)}
                                disabled={busyUid === u.id}
                                className="shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {busyUid === u.id ? "Saving…" : "Save"}
                              </button>
                            )}
                          </div>
                          {isSelf && (
                            <p className="mt-1 text-xs text-gray-400">You can&apos;t change your own role.</p>
                          )}
                          {!isSelf && isLastActiveAdmin && (
                            <p className="mt-1 text-xs text-gray-400">Last active admin — promote another first.</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                u.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {u.isActive ? "Active" : "Inactive"}
                            </span>
                            {isOrphaned && (
                              <span
                                title="No corresponding Firebase Auth account — orphaned from a past seed/migration mistake. Can't be reactivated; see scripts/setup-demo.ts --reset."
                                className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800"
                              >
                                ⚠ No Auth account
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(u)}
                            disabled={deactivateDisabled}
                            title={
                              u.isActive && isLastActiveAdmin
                                ? "This is the last active admin — promote another admin before deactivating."
                                : !u.isActive && isOrphaned
                                  ? "No Auth account for this profile — it can't be reactivated."
                                  : undefined
                            }
                            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                              u.isActive
                                ? "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                            }`}
                          >
                            {busyUid === u.id ? "Working…" : u.isActive ? "Deactivate" : "Reactivate"}
                          </button>
                          {rowErrors[u.id] && (
                            <p className="mt-1 max-w-[200px] text-right text-xs text-red-600">{rowErrors[u.id]}</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
