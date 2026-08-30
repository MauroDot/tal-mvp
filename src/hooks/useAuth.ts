"use client";

/**
 * React hook that tracks Firebase Auth state and the corresponding
 * Firestore user profile (and that profile's Organization).
 *
 * Subscribes to `onAuthStateChanged` on mount; whenever the Firebase user
 * changes, it fetches the matching profile — then, once that succeeds,
 * the org doc — via `organizationService`, and exposes all of it along
 * with loading/error state and a `logout` helper.
 */
import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { auth } from "../lib/firebase";
import { signOut } from "../lib/auth";
import { getOrganization, getUserOrgId, getUserProfile } from "../services/organizationService";
import type { Organization, User } from "../types";

interface UseAuthResult {
  /** Raw Firebase Auth user (identity only), or `null` if signed out. */
  firebaseUser: FirebaseUser | null;
  /** Firestore profile for `firebaseUser` (organization, role, etc.), or `null` if signed out / not yet loaded. */
  user: User | null;
  /** `user`'s Organization (name, settings, etc.), or `null` if signed out / not yet loaded. Used by Layout to show the org's own name in the header instead of generic branding alone. */
  organization: Organization | null;
  /** True while auth state is resolving or the profile fetch is in flight. */
  loading: boolean;
  /** Set if the profile fetch or sign-out fails; cleared on the next successful auth change. */
  error: Error | null;
  /** Signs the current user out. */
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      console.log(
        "[useAuth] onAuthStateChanged fired:",
        fbUser ? { uid: fbUser.uid, email: fbUser.email } : null
      );
      setFirebaseUser(fbUser);
      setError(null);

      if (!fbUser) {
        console.log("[useAuth] No Firebase user — clearing profile, done.");
        setUser(null);
        setOrganization(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        console.log(`[useAuth] Step 1: resolving org via userOrgs/${fbUser.uid} ...`);
        const orgId = await getUserOrgId(fbUser.uid);
        console.log(`[useAuth] Step 1 result: orgId =`, orgId);

        if (!orgId) {
          console.warn(
            `[useAuth] No userOrgs/${fbUser.uid} document (or it has no organizationId field) — ` +
              `cannot resolve which org this user belongs to, so the profile fetch is being skipped. ` +
              `Create a document at userOrgs/${fbUser.uid} with { organizationId: "<orgId>" } to fix this.`
          );
        }

        console.log(
          orgId
            ? `[useAuth] Step 2: fetching organizations/${orgId}/users/${fbUser.uid} ...`
            : "[useAuth] Step 2: skipped (no orgId from step 1)."
        );
        let profile: User | null = null;
        try {
          profile = orgId ? await getUserProfile(orgId, fbUser.uid) : null;
          console.log("[useAuth] Step 2 result: profile =", profile);
        } catch (profileErr) {
          // A permission-denied here, specifically on reading one's OWN
          // profile, can only mean firestore.rules' isOrgMember rejected
          // it — which (barring the doc being deleted outright) means
          // isActive is false: deactivateOrgUser (functions/src/index.ts)
          // flips that flag, and rules re-check it on every request, so
          // this is the enforcement that actually blocks a
          // still-signed-in session immediately, not just future sign-ins
          // (see firestore.rules' isOrgMember comment). Treat it as
          // "no access" and sign out, rather than surfacing a generic
          // Firestore error while leaving them in a half-signed-in state.
          // Any OTHER error code (network blip, etc.) falls through to
          // the outer catch instead — that one doesn't sign out, so a
          // transient failure doesn't destroy a perfectly good session.
          if ((profileErr as { code?: string })?.code !== "permission-denied") {
            throw profileErr;
          }
          console.warn(
            `[useAuth] Reading own profile at organizations/${orgId}/users/${fbUser.uid} was denied — ` +
              "treating as deactivated/no-access and signing out.",
            profileErr
          );
          await signOut();
          setFirebaseUser(null);
          setUser(null);
          setOrganization(null);
          setError(new Error("Your account doesn't have access to this organization. Contact your administrator."));
          setLoading(false);
          return;
        }

        if (orgId && !profile) {
          console.warn(
            `[useAuth] Org resolved to "${orgId}", but organizations/${orgId}/users/${fbUser.uid} ` +
              `doesn't exist. The org lookup is fine — this user just has no profile doc under it yet.`
          );
        }

        setUser(profile);

        // Non-fatal: the org doc is only used for display (Layout's
        // header name) — a failure here shouldn't sign anyone out or
        // block the rest of the app the way a failed profile fetch does.
        if (orgId && profile) {
          try {
            setOrganization(await getOrganization(orgId));
          } catch (orgErr) {
            console.warn(`[useAuth] Failed to load organizations/${orgId} — header will fall back to generic branding.`, orgErr);
            setOrganization(null);
          }
        } else {
          setOrganization(null);
        }
      } catch (err) {
        console.error("[useAuth] Failed while resolving org/profile:", err);
        setUser(null);
        setOrganization(null);
        setError(err instanceof Error ? err : new Error("Failed to load user profile"));
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut();
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to sign out"));
      throw err;
    }
  }, []);

  return { firebaseUser, user, organization, loading, error, logout };
}
