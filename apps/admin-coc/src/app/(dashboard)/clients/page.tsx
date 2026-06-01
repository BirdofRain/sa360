import { ClientCreateForm } from "@/components/clients/client-create-form";
import { ClientsList } from "@/components/clients/clients-list";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { fetchAdminClients, isAdminApiConfigured } from "@/lib/admin-api/server";

export default async function ClientsPage() {
  const configured = isAdminApiConfigured();
  const { data, error } = configured
    ? await fetchAdminClients()
    : { data: null, error: null as string | null };

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Clients &amp; Subaccounts</h1>
            <Badge variant="outline" className="border-sky-600/40 bg-sky-50 text-sky-950">
              ONBOARDING
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Internal client profiles, GHL destinations, and campaign routing rules. Config only — no
            live delivery from this area.
          </p>
        </div>
      </div>

      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY to manage clients.
        </WarningBanner>
      ) : null}

      {error ? (
        <WarningBanner tone="warn" title="Could not load clients">
          {error}
        </WarningBanner>
      ) : null}

      <ClientsList items={items} />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-800">New client</h2>
        <ClientCreateForm />
      </div>

      <p className="text-xs text-muted-foreground">
        For a VET Final Expense pilot: create a client account (e.g. slug + display name), open
        detail, save GHL subaccount + pipeline IDs, then add a campaign_id or utm_campaign routing
        rule. No tenant IDs are hardcoded in application logic.
      </p>
    </div>
  );
}
