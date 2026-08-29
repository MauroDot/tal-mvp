"use client";

/**
 * React hook that tracks Firebase Auth state and the corresponding
 * Firestore user profile.
 *
 * Subscribes to `onAuthStateChanged` on mount; whenever the Firebase user
 * changes, it fetches the matching profile via `organizationService` and
 * exposes both, along with loading/error state and a `logout` helper.
 */
import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { auth } from "../lib/firebase";
import { signOut } from "../lib/auth";
import { getUserOrgId, getUserProfile } from "../services/organizationService";
import type { User } from "../types";

interface UseAuthResult {
  /** Raw Firebase Auth user (identity only), or `null` if signed out. */
  firebaseUser: FirebaseUser | null;
  /** Firestore profile for `firebaseUser` (organization, role, etc.), or `null` if signed out / not yet loaded. */
  user: User | null;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      setError(null);

      if (!fbUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const orgId = await getUserOrgId(fbUser.uid);
        const profile = orgId ? await getUserProfile(orgId, fbUser.uid) : null;
        setUser(profile);
      } catch (err) {
        setUser(null);
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

  return { firebaseUser, user, loading, error, logout };
}
