"use client";

/**
 * Email/password sign-in page. On success, redirects to "/" — the root
 * route resolves the actual role-aware destination (see
 * landingPathForRole in @/lib/routeAccess), so this page doesn't need to
 * know or fetch the signed-in user's role itself.
 *
 * No self-signup: accounts are invite-only (see inviteOrgUser,
 * functions/src/index.ts) — deliberate, not an oversight, so there's no
 * "create an account" link here.
 */
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import { resetPassword, signIn } from "@/lib/auth";

function getErrorMessage(err: unknown): string {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "Incorrect email or password.";
      case "auth/invalid-email":
        return "Enter a valid email address.";
      case "auth/user-disabled":
        return "This account has been disabled. Contact your administrator.";
      case "auth/too-many-requests":
        return "Too many attempts. Please wait a moment and try again.";
      default:
        return "Something went wrong signing in. Please try again.";
    }
  }
  return "Something went wrong signing in. Please try again.";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forgot password is a separate small flow, not a route — toggled
  // in place so "back to sign in" doesn't lose whatever email was
  // already typed.
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      router.push("/");
    } catch (err) {
      setError(getErrorMessage(err));
      setLoading(false);
    }
  };

  const openReset = () => {
    setResetEmail(email);
    setResetMessage(null);
    setShowReset(true);
  };

  const handleResetSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resetEmail.trim()) {
      return;
    }
    setResetSubmitting(true);
    // Deliberately the SAME message whether this succeeds, the address
    // isn't registered, or it's malformed — sendPasswordResetEmail can
    // reject with auth/user-not-found, and surfacing that (or any other
    // outcome-specific detail) would let this form be used to check
    // which emails have accounts. Every path below ends the same way.
    try {
      await resetPassword(resetEmail.trim());
    } catch {
      // Swallowed on purpose — see above.
    }
    setResetMessage("If an account exists for that email address, a password reset link has been sent.");
    setResetSubmitting(false);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-blue-600 text-base font-bold text-white">
            TAL
          </span>
          <h1 className="mt-3 text-xl font-semibold text-gray-900">
            {showReset ? "Reset your password" : "Sign in to Tactical Asset Log"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {showReset ? "Enter your email and we'll send you a reset link." : "Enter your credentials to continue."}
          </p>
        </div>

        {showReset ? (
          <form onSubmit={handleResetSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="reset-email" className="mb-1 block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="reset-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                className="block w-full rounded-md border border-gray-300 px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="you@example.com"
              />
            </div>

            {resetMessage && (
              <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                {resetMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={resetSubmitting || !resetEmail.trim()}
              className="flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {resetSubmitting ? "Sending…" : "Send reset link"}
            </button>

            <button
              type="button"
              onClick={() => setShowReset(false)}
              className="w-full text-center text-sm font-medium text-gray-600 hover:text-blue-700"
            >
              ← Back to sign in
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="block w-full rounded-md border border-gray-300 px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <button
                  type="button"
                  onClick={openReset}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  Forgot password?
                </button>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="block w-full rounded-md border border-gray-300 px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        <div className="mt-6 flex justify-center gap-4 border-t border-gray-100 pt-4 text-xs text-gray-500">
          <Link href="/faq" className="hover:text-blue-700 hover:underline">
            FAQ
          </Link>
          <Link href="/contact" className="hover:text-blue-700 hover:underline">
            Contact
          </Link>
        </div>
      </div>
    </main>
  );
}
