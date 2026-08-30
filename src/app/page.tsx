"use client";

/**
 * Root route: no UI of its own, just an auth-based redirect — signed-in
 * users go to /dashboard, everyone else to /auth/login. Replaces the
 * default create-next-app starter page.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

export default function Home() {
  const router = useRouter();
  const { firebaseUser, loading } = useAuth();

  useEffect(() => {
    if (loading) {
      return;
    }
    router.replace(firebaseUser ? "/dashboard" : "/auth/login");
  }, [loading, firebaseUser, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <p className="text-sm text-gray-500">Loading…</p>
    </div>
  );
}
