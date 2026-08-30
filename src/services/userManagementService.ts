/**
 * Admin user-management actions: invite, change role, deactivate,
 * reactivate. Every one of these is a call into a Cloud Function
 * (functions/src/index.ts), not a direct Firestore write —
 * firestore.rules denies all client writes to
 * organizations/{orgId}/users outright (a user editing their own `role`
 * would be a privilege-escalation hole), so this file has no `setDoc`/
 * `updateDoc` calls in it at all. Each callable re-derives the caller's
 * org and admin status itself, server-side; the org/role/isActive
 * checked here client-side (see AccessDenied / disabled buttons in
 * admin/users/page.tsx) is UX only — the callables are what actually
 * enforce it.
 *
 * Listing users reuses organizationService.listUsers — reading the users
 * subcollection is allowed for any org member (see firestore.rules), so
 * that's a plain Firestore read like everywhere else in this app; only
 * the writes route through Cloud Functions.
 */
import { httpsCallable } from "firebase/functions";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth, functionsInstance } from "../lib/firebase";
import type { UserRole } from "../types";

export interface InviteUserFields {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

/**
 * Invites a new user: calls `inviteOrgUser` (creates the Auth account +
 * Firestore profile + userOrgs doc + audit log, admin-only, server-side
 * org-verified), then — only once that's succeeded — sends the actual
 * password-reset email via the client SDK's `sendPasswordResetEmail`.
 * That two-step split isn't a workaround; it's how it has to work: the
 * Admin SDK inside the Cloud Function can generate a reset *link* but has
 * no way to deliver an email itself, only the client SDK can trigger
 * Firebase's built-in email sending (see inviteOrgUser's doc comment for
 * the full reasoning).
 *
 * If the account/profile were created but the reset email fails to send
 * (network hiccup, etc.), this throws with that distinction in the
 * message — the account still exists, and the invitee can use "Forgot
 * password" on the login page instead, which is the same mechanism.
 */
export async function inviteUser(fields: InviteUserFields): Promise<{ uid: string; email: string }> {
  const invite = httpsCallable<InviteUserFields, { uid: string; email: string }>(functionsInstance, "inviteOrgUser");
  const result = await invite(fields);

  try {
    await sendPasswordResetEmail(auth, result.data.email);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${result.data.email} was created, but the invite email failed to send (${message}). ` +
        `They can use "Forgot password" on the login page instead.`
    );
  }

  return result.data;
}

/**
 * Changes another user's role via `changeOrgUserRole`. Server-rejects
 * changing your own role, and demoting the org's last active admin — see
 * that function's doc comment. Errors from the callable (HttpsError)
 * carry a `message` matching what the function threw, so surfacing
 * `err.message` in the UI shows the real reason.
 */
export async function changeUserRole(targetUid: string, newRole: UserRole): Promise<void> {
  const changeRole = httpsCallable<{ targetUid: string; newRole: UserRole }, { uid: string; role: UserRole }>(
    functionsInstance,
    "changeOrgUserRole"
  );
  await changeRole({ targetUid, newRole });
}

/** Deactivates a user via `deactivateOrgUser` — see that function's doc comment for what "blocks sign-in" actually means here. */
export async function deactivateUser(targetUid: string): Promise<void> {
  const deactivate = httpsCallable<{ targetUid: string }, { uid: string }>(functionsInstance, "deactivateOrgUser");
  await deactivate({ targetUid });
}

/** Reactivates a user via `reactivateOrgUser`. */
export async function reactivateUser(targetUid: string): Promise<void> {
  const reactivate = httpsCallable<{ targetUid: string }, { uid: string }>(functionsInstance, "reactivateOrgUser");
  await reactivate({ targetUid });
}

/**
 * Returns the uids of org users with no corresponding Firebase Auth
 * account — orphaned profiles left over from a past seed/migration
 * mistake (see scripts/setup-demo.ts's --reset for how they're cleaned
 * up). `reactivateOrgUser` refuses to reactivate one of these with a
 * clear error; this is what lets the user list flag them *before* an
 * admin tries and hits that error. The client can't determine this on
 * its own — checking whether an arbitrary uid has an Auth account is an
 * Admin SDK capability — so this always calls the server; if the call
 * itself fails, callers should treat that as "unknown" rather than
 * "none are orphaned" (see admin/users/page.tsx).
 */
export async function checkOrphanedUsers(): Promise<string[]> {
  const check = httpsCallable<Record<string, never>, { orphanedUids: string[] }>(
    functionsInstance,
    "checkOrphanedUsers"
  );
  const result = await check({});
  return result.data.orphanedUids;
}
