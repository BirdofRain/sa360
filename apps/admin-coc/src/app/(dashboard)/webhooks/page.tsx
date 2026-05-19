import { WebhookMonitorFilters } from "@/components/dashboard/webhook-monitor-filters";
import { WebhookMonitorLiveRefresh } from "@/components/dashboard/webhook-monitor-live-refresh";
import { WebhookMonitorView } from "@/components/dashboard/webhook-monitor-view";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { fetchAdminWebhookRequests, isAdminApiConfigured } from "@/lib/admin-api/server";
import {
  parseWebhookMonitorSearchParams,
  webhookMonitorToAdminApiParams,
} from "@/lib/webhook-monitor-query";

export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = parseWebhookMonitorSearchParams(sp);
  const configured = isAdminApiConfigured();
  const apiParams = webhookMonitorToAdminApiParams(query);
  const { items, error } = await fetchAdminWebhookRequests(apiParams);

  const emptyHint =
    configured && !error
      ? items.length === 0
        ? "No webhook requests match these filters."
        : "No webhook requests in this window."
      : null;

  return (
    <div className="space-y-6">
      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY (or ADMIN_API_KEY) to load webhook requests.
        </WarningBanner>
      ) : null}
      {configured && error ? (
        <WarningBanner tone="warn" title="Webhook request log unavailable">
          {error}
        </WarningBanner>
      ) : null}

      <WebhookMonitorLiveRefresh enabled={Boolean(query.live)} />

      <WebhookMonitorFilters initial={query} />

      <WebhookMonitorView items={items} query={query} emptyHint={emptyHint} />
    </div>
  );
}
