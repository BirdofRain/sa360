import type { Metadata } from "next";

import { ActionCenterApp } from "./action-center-app";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import {
  fetchActionDashboardToday,
  isAdminApiConfigured,
} from "@/lib/admin-api/server";
import { mapActionDashboardToUi } from "@/lib/action-center/map-action-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Daily Action Center | SA360",
  description:
    "Agent execution console — who to call first today, KPIs, and AI activity (read-only MVP).",
};

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-slate-100 p-6">{children}</div>;
}

function Narrow({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-lg">{children}</div>;
}

export default async function ActionCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const clientAccountId = firstString(sp.clientAccountId)?.trim() ?? "";
  const locationId = firstString(sp.locationId);
  const agentDisplayName = firstString(sp.agentDisplayName);

  if (!clientAccountId) {
    return (
      <PageShell>
        <Narrow>
          <MissingClientPanel />
        </Narrow>
      </PageShell>
    );
  }

  if (!isAdminApiConfigured()) {
    return (
      <PageShell>
        <Narrow>
          <WarningBanner tone="warn" title="Admin API not configured">
            Set{" "}
            <code className="rounded bg-white/70 px-1 font-mono text-xs">
              NEXT_PUBLIC_SA360_API_BASE_URL
            </code>{" "}
            and{" "}
            <code className="rounded bg-white/70 px-1 font-mono text-xs">
              SA360_ADMIN_API_KEY
            </code>{" "}
            in <code className="font-mono text-xs">apps/admin-coc/.env.local</code>, then restart
            the dev server.
          </WarningBanner>
        </Narrow>
      </PageShell>
    );
  }

  const { data, error } = await fetchActionDashboardToday({
    clientAccountId,
    locationId,
    agentDisplayName,
  });

  if (!data || error) {
    return (
      <PageShell>
        <Narrow>
          <WarningBanner tone="err" title="Could not load action dashboard">
            {error ?? "Unknown error"}
          </WarningBanner>
        </Narrow>
      </PageShell>
    );
  }

  const mapped = mapActionDashboardToUi(data);

  return (
    <ActionCenterApp
      dashboard={{
        ok: mapped.ok,
        generatedAt: mapped.generatedAt,
        clientAccountId: mapped.clientAccountId,
        locationId: mapped.locationId,
        agentDisplayName: mapped.agentDisplayName,
        ghlConnection: mapped.ghlConnection,
        kpis: mapped.kpis,
        priorityCalls: mapped.priorityCalls,
        activeLeads: mapped.activeLeads,
        aiActivityFeed: mapped.aiActivityFeed,
      }}
      setupWarnings={mapped.setupWarnings}
    />
  );
}

function MissingClientPanel() {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950 shadow-sm">
      <p className="font-semibold">Missing client account</p>
      <p className="mt-2 leading-relaxed text-amber-950/90">
        Add{" "}
        <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">clientAccountId</code>{" "}
        to the URL (from a GHL custom value or location mapping). Optional:{" "}
        <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">locationId</code>,{" "}
        <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">
          agentDisplayName
        </code>
        .
      </p>
      <p className="mt-3 font-mono text-xs text-amber-900/80">
        Example: /action-center?clientAccountId=demo&amp;locationId=loc_demo_ghl_001
      </p>
    </div>
  );
}
