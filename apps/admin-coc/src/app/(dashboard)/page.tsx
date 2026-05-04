import { Activity } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { fetchAdminMetricsSummary, isAdminApiConfigured } from "@/lib/admin-api/server";

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

/** Command Center — KPIs from `GET /admin/v1/metrics/summary` (default range: last 7 days + UTC “today” counts). */
export default async function CommandCenterPage() {
  const configured = isAdminApiConfigured();
  const { summary, error } = await fetchAdminMetricsSummary();

  return (
    <div className="space-y-5">
      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL to your Fastify origin (for example http://localhost:3000) and a server-only
          key: SA360_ADMIN_API_KEY or ADMIN_API_KEY (same value as the API’s ADMIN_API_KEY). Restart the Next dev server
          after editing apps/admin-coc/.env.local.
        </WarningBanner>
      ) : null}

      {configured && error ? (
        <WarningBanner tone="warn" title="Could not load admin metrics">
          {error}
        </WarningBanner>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Webhook requests today"
          value={summary ? summary.webhookRequestsToday : "—"}
          hint="UTC day · GHL lifecycle source"
          tone="neutral"
        />
        <StatTile
          label="GHL webhooks (7d)"
          value={summary ? summary.webhookRequestsTotal : "—"}
          hint="Default API summary window"
          tone="neutral"
        />
        <StatTile
          label="Synthflow lookups today"
          value={summary ? summary.synthflowRequestsToday : "—"}
          hint="UTC day"
          tone="neutral"
        />
        <StatTile
          label="Known caller match rate"
          value={summary ? knownCallerRatePct(summary) : "—"}
          hint="Synthflow known vs unknown (range totals)"
          tone="neutral"
        />
        <StatTile
          label="Failed requests"
          value={summary ? summary.webhookFailures + summary.synthflowLookupErrors : "—"}
          hint="Webhook failures + Synthflow lookup errors"
          tone={summary && summary.webhookFailures + summary.synthflowLookupErrors > 0 ? "bad" : "neutral"}
        />
        <StatTile
          label="Queue health"
          value={summary ? summary.webhookQueued : "—"}
          hint={summary ? `avg webhook ${formatMs(summary.averageWebhookDurationMs)}` : "p95 when wired"}
          tone="neutral"
        />
        <StatTile label="Open review items" value="—" hint="Not exposed on admin API yet" tone="neutral" />
        <StatTile
          label="Skipped · failed · guardrail"
          value={
            summary
              ? `${summary.webhookSkipped} · ${summary.webhookFailures} · ${summary.synthflowGuardrails}`
              : "—"
          }
          hint="Webhook skipped · webhook failed · Synthflow guardrail"
          tone="neutral"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionPanel title="Latest critical issues">
            <EmptyState
              icon={Activity}
              title="No automated issue feed yet"
              hint="Wire alert sources or review queues when the admin API exposes them."
              className="py-10"
            />
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
