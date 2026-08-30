"use client";

/**
 * Root route: no UI of its own, just an auth- and role-based redirect —
 * see landingPathForRole for where each role lands; everyone signed out
 * goes to /auth/login. Replaces the default create-next-app starter page.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { landingPathForRole } from "@/lib/routeAccess";

export default function Home() {
  const router = useRouter();
  const { firebaseUser, user, loading } = useAuth();

  useEffect(() => {
    if (loading) {
      return;
    }
    router.replace(firebaseUser ? landingPathForRole(user?.role) : "/auth/login");
  }, [loading, firebaseUser, user, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <p className="text-sm text-gray-500">Loading…</p>
    </div>
  );
}
