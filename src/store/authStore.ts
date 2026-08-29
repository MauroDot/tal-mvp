/**
 * Global auth state store.
 *
 * Holds the signed-in user's profile (as loaded from Firestore, keyed by
 * their Firebase Auth UID) along with quick-access `organizationId`/`role`
 * fields for cheap access-control checks without reaching into `user`.
 * Populate this from an `onAuthStateChange` listener + profile lookup at
 * the app root, and read from it anywhere via `useAuthStore`.
 */
import { create } from "zustand";
import type { User, UserRole } from "../types";

interface AuthState {
  /** The signed-in user's profile, or `null` if signed out / not yet loaded. */
  user: User | null;
  /** ID of the Organization the current user belongs to, or `null` if signed out. */
  organizationId: string | null;
  /** The current user's role within their organization, or `null` if signed out. */
  role: UserRole | null;

  /**
   * Sets the signed-in user's profile. Also syncs `organizationId` and
   * `role` from it (or clears them when `user` is `null`), so callers
   * don't need to set those separately after loading a profile.
   */
  setUser: (user: User | null) => void;
  /** Sets/overrides the current organization ID (e.g. when switching orgs). */
  setOrganization: (organizationId: string | null) => void;
  /** Resets all auth state to its signed-out defaults (call this on sign-out). */
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  organizationId: null,
  role: null,

  setUser: (user) =>
    set({
      user,
      organizationId: user?.organizationId ?? null,
      role: user?.role ?? null,
    }),
  setOrganization: (organizationId) => set({ organizationId }),
  clearAuth: () => set({ user: null, organizationId: null, role: null }),
}));
