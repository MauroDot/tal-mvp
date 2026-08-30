"use client";

/**
 * Admin home: where an admin lands right after sign-in (see
 * landingPathForRole, @/lib/routeAccess) — a hub linking to the actual
 * management pages, with org-wide counts, rather than "My Vehicles"
 * (/dashboard), which is an officer's personal view and isn't relevant
 * to what an admin needs first.
 *
 * Gated to ROUTE_ROLES.admin (admin only).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import AccessDenied from "@/components/AccessDenied";
import Layout from "@/components/Layout";
import { ROUTE_ROLES } from "@/lib/routeAccess";
import { useRequireRole } from "@/hooks/useRequireRole";
import { listUsers } from "@/services/organizationService";
import { listLatestTemplates } from "@/services/inspectionTemplateService";
import { listVehicles } from "@/services/vehicleService";

interface HubCard {
  href: string;
  title: string;
  description: string;
  count: string | null;
}

export default function AdminHomePage() {
  const { status, user } = useRequireRole(ROUTE_ROLES.admin);

  const [counts, setCounts] = useState<{ users: number; templates: number; vehicles: number } | null>(null);
  const [countsError, setCountsError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "allowed" || !user) {
      return;
    }
    let cancelled = false;

    async function load(orgId: string) {
      try {
        const [users, templates, vehicles] = await Promise.all([
          listUsers(orgId),
          listLatestTemplates(orgId),
          listVehicles(orgId),
        ]);
        if (!cancelled) {
          setCounts({ users: users.length, templates: templates.length, vehicles: vehicles.length });
        }
      } catch (err) {
        if (!cancelled) {
          setCountsError(err instanceof Error ? err.message : "Failed to load counts.");
        }
      }
    }

    load(user.organizationId);
    return () => {
      cancelled = true;
    };
  }, [status, user]);

  const cards: HubCard[] = [
    {
      href: "/admin/users",
      title: "Users",
      description: "Invite, change roles, deactivate/reactivate.",
      count: counts ? `${counts.users} user${counts.users === 1 ? "" : "s"}` : null,
    },
    {
      href: "/admin/templates",
      title: "Inspection Templates",
      description: "Create, edit, version, and activate checklists.",
      count: counts ? `${counts.templates} template${counts.templates === 1 ? "" : "s"}` : null,
    },
    {
      href: "/fleet",
      title: "Fleet",
      description: "Every vehicle in the organization.",
      count: counts ? `${counts.vehicles} vehicle${counts.vehicles === 1 ? "" : "s"}` : null,
    },
    {
      href: "/admin/settings",
      title: "Organization Settings",
      description: "Org name and inspection interval.",
      count: null,
    },
  ];

  return (
    <Layout>
      {status === "loading" ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : status === "denied" ? (
        <AccessDenied requiredRoles={ROUTE_ROLES.admin} />
      ) : (
        <div className="mx-auto max-w-4xl">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Admin</h1>
            <p className="mt-1 text-sm text-gray-500">Organization-wide management.</p>
          </div>

          {countsError && (
            <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {countsError}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {cards.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50"
              >
                <h2 className="text-base font-semibold text-gray-900">{card.title}</h2>
                <p className="mt-1 text-sm text-gray-500">{card.description}</p>
                <p className="mt-3 text-sm font-medium text-blue-700">{card.count ?? " "}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </Layout>
  );
}
