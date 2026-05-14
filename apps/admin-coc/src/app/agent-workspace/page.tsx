import type { Metadata } from "next";

import { AgentWorkspaceApp } from "./agent-workspace-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent Workspace | SA360",
  description: "Embedded agent workspace for GoHighLevel and internal operators.",
};

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

export default async function AgentWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const clientAccountId = firstString(sp.clientAccountId)?.trim() ?? "";

  if (!clientAccountId) {
    return (
      <div className="min-h-dvh bg-slate-50 p-6">
        <div className="mx-auto max-w-lg rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950 shadow-sm">
          <p className="font-semibold text-amber-950">Missing client account</p>
          <p className="mt-2 leading-relaxed text-amber-950/90">
            Add <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">clientAccountId</code> to the
            URL (for example from a GHL custom value). Optional query params:{" "}
            <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">locationId</code>,{" "}
            <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">contactId</code>,{" "}
            <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">leadUid</code>, optional{" "}
            <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">nicheKey</code>,{" "}
            <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">lifecycleStage</code> (guidance
            filters; index-derived when omitted).
          </p>
        </div>
      </div>
    );
  }

  return (
    <AgentWorkspaceApp
      clientAccountId={clientAccountId}
      locationId={firstString(sp.locationId)}
      contactId={firstString(sp.contactId)}
      leadUid={firstString(sp.leadUid)}
      nicheKey={firstString(sp.nicheKey)}
      lifecycleStage={firstString(sp.lifecycleStage)}
    />
  );
}
