import Link from "next/link";

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

/** Command Center diagnostics. Operator work lives in the queues linked from this page. */
export default async function CommandCenterPage() {
  const configured = isAdminApiConfigured();

  const [metricsRes, validationFailedRes, unauthorizedRes] = await Promise.all([
    fetchAdminMetricsSummary(),
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

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-slate-800">Diagnostics</h2>
          <p className="mt-1 text-sm text-slate-600">
            Webhook request health, invalid payloads, and failures are in Webhook Monitor.
          </p>
        </div>
        <Link
          href="/webhooks"
          className="text-sm font-medium text-slate-800 underline underline-offset-4 hover:underline"
        >
          Webhook Monitor
        </Link>
      </div>

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
          hint="API default window (~last 7 days) · GHL lifecycle"
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
      </div>

      {summary?.latestWebhookAt ? (
        <p className="text-xs text-slate-400">Latest webhook received: {summary.latestWebhookAt}</p>
      ) : null}

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
  );
}
