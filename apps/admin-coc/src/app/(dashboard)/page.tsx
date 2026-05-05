import { Suspense } from "react";
import Link from "next/link";

import { CommandCenterRangeFilters } from "@/components/dashboard/command-center-range-filters";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  RecentInvalidWebhooks,
  RecentInvalidWebhooksFooter,
} from "@/components/dashboard/recent-invalid-webhooks";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import {
  fetchAdminMetricsSummary,
  fetchAdminWebhookRequests,
  isAdminApiConfigured,
} from "@/lib/admin-api/server";
import type { AdminWebhookListItem } from "@/lib/admin-api/types";

function formatMs(ms: number | null): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  return `${Math.round(ms)} ms`;
}

function knownCallerRatePct(summary: {
  synthflowKnownCallerCount: number;
  synthflowUnknownCallerCount: number;
}): string {
  const k = summary.synthflowKnownCallerCount;
  const u = summary.synthflowUnknownCallerCount;
  const t = k + u;
  if (t === 0) return "—";
  return `${Math.round((k / t) * 100)}%`;
}

function firstParam(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
}

function rangeHint(from?: string, to?: string): string {
  if (from && to) {
    try {
      const a = new Date(from);
      const b = new Date(to);
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
        return `${a.toLocaleDateString()} → ${b.toLocaleDateString()} · GHL lifecycle`;
      }
    } catch {
      /* fall through */
    }
  }
  return "API default window (~last 7 days) · GHL lifecycle";
}

function mergeInvalidWebhookSamples(
  a: AdminWebhookListItem[],
  b: AdminWebhookListItem[]
): AdminWebhookListItem[] {
  const byId = new Map<string, AdminWebhookListItem>();
  for (const row of [...a, ...b]) byId.set(row.id, row);
  return [...byId.values()].sort(
    (x, y) => new Date(y.receivedAt).getTime() - new Date(x.receivedAt).getTime()
  );
}

/** Command Center — KPIs from `GET /admin/v1/coc/summary-metrics` plus sampled invalid webhooks. */
export default async function CommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const from = firstParam(sp.from);
  const to = firstParam(sp.to);
  const configured = isAdminApiConfigured();

  const [metricsRes, validationFailedRes, unauthorizedRes] = await Promise.all([
    fetchAdminMetricsSummary({ from, to }),
    configured
      ? fetchAdminWebhookRequests({ processingStatus: "validation_failed", limit: 12 })
      : Promise.resolve({ items: [] as AdminWebhookListItem[], nextCursor: null, error: null }),
    configured
      ? fetchAdminWebhookRequests({ processingStatus: "unauthorized", limit: 12 })
      : Promise.resolve({ items: [] as AdminWebhookListItem[], nextCursor: null, error: null }),
  ]);

  const { summary, error } = metricsRes;
  const invalidRecent = mergeInvalidWebhookSamples(
    validationFailedRes.items,
    unauthorizedRes.items
  ).slice(0, 10);

  const invalidSampleError =
    validationFailedRes.error || unauthorizedRes.error
      ? [validationFailedRes.error, unauthorizedRes.error].filter(Boolean).join(" · ")
      : null;

  return (
    <div className="space-y-5">
      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL to your Fastify origin (for example http://localhost:3000) and a server-only key:
          SA360_ADMIN_API_KEY or ADMIN_API_KEY (same value as the API’s ADMIN_API_KEY). Restart the Next dev server after
          editing apps/admin-coc/.env.local. Keys are never sent to the browser.
        </WarningBanner>
      ) : null}

      {configured && error ? (
        <WarningBanner tone="warn" title="Could not load admin metrics">
          {error}
        </WarningBanner>
      ) : null}

      <Suspense
        fallback={<div className="h-16 animate-pulse rounded-xl border border-slate-200 bg-slate-50" aria-hidden />}
      >
        <CommandCenterRangeFilters />
      </Suspense>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Webhook requests today"
          value={summary ? summary.webhookRequestsToday : "—"}
          hint="UTC midnight → now · GHL lifecycle"
          tone="neutral"
        />
        <StatTile
          label="Webhooks (summary window)"
          value={summary ? summary.webhookRequestsTotal : "—"}
          hint={rangeHint(from, to)}
          tone="neutral"
        />
        <StatTile
          label="Invalid payloads (window)"
          value={summary ? summary.webhookValidationFailures : "—"}
          hint="processingStatus = validation_failed"
          tone={summary && summary.webhookValidationFailures > 0 ? "bad" : "neutral"}
        />
        <StatTile
          label="Failed webhooks (window)"
          value={summary ? summary.webhookFailures : "—"}
          hint="failed status or HTTP ≥ 500"
          tone={summary && summary.webhookFailures > 0 ? "bad" : "neutral"}
        />
        <StatTile
          label="Synthflow lookups today"
          value={summary ? summary.synthflowRequestsToday : "—"}
          hint="UTC midnight → now"
          tone="neutral"
        />
        <StatTile
          label="Synthflow lookups (window)"
          value={summary ? summary.synthflowRequestsTotal : "—"}
          hint="Matches summary date window"
          tone="neutral"
        />
        <StatTile
          label="Known caller match rate"
          value={summary ? knownCallerRatePct(summary) : "—"}
          hint="Known vs unknown caller (window totals)"
          tone="neutral"
        />
        <StatTile
          label="Synthflow lookup errors"
          value={summary ? summary.synthflowLookupErrors : "—"}
          hint="lookup_error status / lookupStatus"
          tone={summary && summary.synthflowLookupErrors > 0 ? "warn" : "neutral"}
        />
        <StatTile
          label="Meta queue depth"
          value={summary ? summary.webhookQueued : "—"}
          hint={
            summary
              ? `Avg webhook ${formatMs(summary.averageWebhookDurationMs)} · synth ${formatMs(summary.averageSynthflowDurationMs)}`
              : "Queued lifecycle dispatches"
          }
          tone="neutral"
        />
        <StatTile
          label="Skipped · guardrails"
          value={
            summary ? `${summary.webhookSkipped} · ${summary.synthflowGuardrails}` : "—"
          }
          hint="Webhook skipped · Synthflow guardrail / validation_failed"
          tone="neutral"
        />
        <StatTile label="Open review items" value="—" hint="Not exposed on admin API yet" tone="neutral" />
      </div>

      {(summary?.latestWebhookAt || summary?.latestSynthflowAt) && (
        <p className="text-xs text-slate-400">
          Latest webhook received: {summary?.latestWebhookAt ?? "—"} · Latest Synthflow:{" "}
          {summary?.latestSynthflowAt ?? "—"}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionPanel
            title="Recent invalid webhooks"
            action={
              <Link
                href="/webhooks"
                className="text-xs font-medium text-slate-600 underline-offset-4 hover:underline"
              >
                Webhook Monitor
              </Link>
            }
          >
            {configured && invalidSampleError ? (
              <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                Could not load full invalid sample: {invalidSampleError}
              </p>
            ) : null}
            <RecentInvalidWebhooks items={invalidRecent} />
            <RecentInvalidWebhooksFooter />
          </SectionPanel>
        </div>
        <SectionPanel title="Clients needing attention">
          <EmptyState
            title="No client alerts"
            hint="Connect client health endpoints to populate this panel."
            className="py-10"
          />
        </SectionPanel>
      </div>
    </div>
  );
}
