/**
 * Authentication helpers built on top of the Firebase Auth client SDK.
 *
 * These wrap the modular `firebase/auth` functions around the shared
 * `auth` instance from `@/lib/firebase`, so callers don't need to import
 * or reference the Firebase Auth SDK directly.
 */
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
  type UserCredential,
  type Unsubscribe,
} from "firebase/auth";
import { auth } from "./firebase";

/**
 * Creates a new Firebase Auth user with the given email/password and signs
 * them in. Throws a `FirebaseError` (e.g. `auth/email-already-in-use`,
 * `auth/weak-password`) if account creation fails.
 */
export async function signUp(email: string, password: string): Promise<UserCredential> {
  return createUserWithEmailAndPassword(auth, email, password);
}

/**
 * Signs in an existing user with email/password. Throws a `FirebaseError`
 * (e.g. `auth/invalid-credential`, `auth/user-disabled`) if sign-in fails.
 */
export async function signIn(email: string, password: string): Promise<UserCredential> {
  return signInWithEmailAndPassword(auth, email, password);
}

/**
 * Signs out the currently authenticated user.
 */
export async function signOut(): Promise<void> {
  return firebaseSignOut(auth);
}

/**
 * Sends a password-reset email for `email`, if an account exists for it.
 * Callers should NOT surface whether this throws (e.g. `auth/user-not-found`)
 * to the user — doing so would let the login page be used to check which
 * emails are registered. Show the same generic confirmation regardless of
 * outcome (see auth/login/page.tsx).
 */
export async function resetPassword(email: string): Promise<void> {
  return sendPasswordResetEmail(auth, email);
}

/**
 * Returns the currently signed-in Firebase user, or `null` if no one is
 * signed in. Note: this reflects Auth's in-memory state and may be `null`
 * momentarily on initial page load before Firebase has restored the
 * persisted session — prefer `onAuthStateChange` when you need to react
 * to that initial resolution.
 */
export function getCurrentUser(): User | null {
  return auth.currentUser;
}

/**
 * Subscribes to authentication state changes (sign-in, sign-out, token
 * refresh-triggered reloads). `callback` is invoked immediately with the
 * current user (or `null`), and again on every subsequent change.
 *
 * Returns an unsubscribe function — call it (e.g. in a `useEffect` cleanup)
 * to stop listening.
 */
export function onAuthStateChange(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, callback);
}
