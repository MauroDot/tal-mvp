"use client";

/**
 * App shell: a header (logo + signed-in user + logout) and footer wrapped
 * around page content. Mobile-first, gray/blue color scheme.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "../hooks/useAuth";
import { ROUTE_ROLES } from "../lib/routeAccess";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, firebaseUser, loading, logout } = useAuth();

  const displayName = user
    ? `${user.firstName} ${user.lastName}`
    : (firebaseUser?.email ?? (loading ? "Loading…" : null));

  // Mirrors ROUTE_ROLES — an officer shouldn't see a link that will just
  // reject them (see useRequireRole for the actual gate).
  const canSeeFleetNav = user ? ROUTE_ROLES.fleet.includes(user.role) : false;
  const canSeeWorkOrdersNav = user ? ROUTE_ROLES.workOrders.includes(user.role) : false;
  const canSeeTemplatesNav = user ? ROUTE_ROLES.templates.includes(user.role) : false;
  const canSeeUsersNav = user ? ROUTE_ROLES.users.includes(user.role) : false;

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // logout() already surfaces failures via useAuth's `error` state
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/dashboard" className="flex min-w-0 shrink-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white">
                TAL
              </span>
              <span className="truncate text-lg font-semibold text-blue-700">
                Tactical Asset Log
              </span>
            </Link>

            {(canSeeFleetNav || canSeeWorkOrdersNav || canSeeTemplatesNav || canSeeUsersNav) && (
              <nav className="hidden gap-4 sm:flex">
                {canSeeFleetNav && (
                  <Link href="/fleet" className="text-sm font-medium text-gray-600 hover:text-blue-700">
                    Fleet
                  </Link>
                )}
                {canSeeWorkOrdersNav && (
                  <Link href="/work-orders" className="text-sm font-medium text-gray-600 hover:text-blue-700">
                    Work Orders
                  </Link>
                )}
                {canSeeTemplatesNav && (
                  <Link href="/admin/templates" className="text-sm font-medium text-gray-600 hover:text-blue-700">
                    Templates
                  </Link>
                )}
                {canSeeUsersNav && (
                  <Link href="/admin/users" className="text-sm font-medium text-gray-600 hover:text-blue-700">
                    Users
                  </Link>
                )}
              </nav>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {displayName && (
              <span className="max-w-[110px] truncate text-sm text-gray-600 sm:max-w-[220px]">
                {displayName}
              </span>
            )}
            {firebaseUser && (
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
              >
                Log out
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 text-center text-xs text-gray-500 sm:px-6">
          © {new Date().getFullYear()} Tactical Asset Log. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
