import { GhlConnectionsTable } from "@/components/ghl-connections/ghl-connections-table";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { fetchAdminGhlConnections, isAdminApiConfigured } from "@/lib/admin-api/server";

export default async function GhlConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const configured = isAdminApiConfigured();
  const { data, error } = configured
    ? await fetchAdminGhlConnections()
    : { data: null, error: null as string | null };

  const oauth = typeof sp.ghl_oauth === "string" ? sp.ghl_oauth : null;
  const oauthReason = typeof sp.reason === "string" ? sp.reason : null;
  const oauthLocationId = typeof sp.locationId === "string" ? sp.locationId : null;

  let oauthNotice: string | null = null;
  if (oauth === "connected") {
    oauthNotice = oauthLocationId
      ? `GHL OAuth connected for location ${oauthLocationId}. Link it to a client account if needed.`
      : "GHL OAuth connected successfully.";
  } else if (oauth === "error") {
    oauthNotice = oauthReason ? `GHL OAuth failed: ${oauthReason}` : "GHL OAuth failed.";
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">GHL Connections</h1>
          <Badge variant="outline" className="border-sky-600/40 bg-sky-50 text-sky-950">
            OAUTH
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect HighLevel subaccounts via Marketplace OAuth. Tokens stay on the API server only — no
          live delivery runs during connect.
        </p>
      </div>

      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY to manage GHL connections.
        </WarningBanner>
      ) : null}

      {error ? (
        <WarningBanner tone="warn" title="Could not load connections">
          {error}
        </WarningBanner>
      ) : null}

      <GhlConnectionsTable initialItems={data?.items ?? []} oauthNotice={oauthNotice} />
    </div>
  );
}
