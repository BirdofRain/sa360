import { WebhookMonitorTable } from "@/components/dashboard/webhook-monitor-table";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { fetchAdminWebhookRequests, isAdminApiConfigured } from "@/lib/admin-api/server";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function WebhooksPage() {
  const configured = isAdminApiConfigured();
  const { items, error } = await fetchAdminWebhookRequests({ limit: 50 });

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

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="grid w-full max-w-xs gap-2">
          <Label htmlFor="filter-client">Client</Label>
          <Input id="filter-client" placeholder="client_account_id" disabled />
        </div>
        <div className="grid w-full max-w-xs gap-2">
          <Label htmlFor="filter-status">Status</Label>
          <Input id="filter-status" placeholder="queued, failed…" disabled />
        </div>
      </div>
      <WebhookMonitorTable items={items} emptyHint={configured && !error ? "No webhook requests in this window." : null} />
    </div>
  );
}
