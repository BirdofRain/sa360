import { GhlConnectionsTable } from "@/components/ghl-connections/ghl-connections-table";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import {
  fetchAdminGhlConnections,
  fetchAdminGhlOAuthDebug,
  isAdminApiConfigured,
} from "@/lib/admin-api/server";

function formatGhlOAuthReason(reason: string | null): string {
  switch (reason) {
    case "token_exchange_failed":
      return "Token exchange with HighLevel failed. Verify GHL_OAUTH_* env vars and callback URL on the API.";
    case "state_invalid":
      return "OAuth state was missing, invalid, or expired. Start Connect again from this page.";
    case "storage_failed":
      return "Tokens were received but could not be saved. Check API database connectivity and migrations.";
    case "missing_location":
      return "OAuth succeeded but no subaccount locationId was returned. Reinstall at sub-account level.";
    default:
      return reason ?? "Unknown OAuth error.";
  }
}

export default async function GhlConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const configured = isAdminApiConfigured();
  const [{ data, error }, oauthDebugRes] = configured
    ? await Promise.all([fetchAdminGhlConnections(), fetchAdminGhlOAuthDebug()])
    : [
        { data: null, error: null as string | null },
        { data: null, error: null as string | null },
      ];
  const oauthDebug = oauthDebugRes.data?.latest ?? null;

  const oauth = typeof sp.ghl_oauth === "string" ? sp.ghl_oauth : null;
  const oauthReason = typeof sp.reason === "string" ? sp.reason : null;
  const oauthLocationId = typeof sp.locationId === "string" ? sp.locationId : null;

  let oauthNotice: string | null = null;
  if (oauth === "connected") {
    oauthNotice = oauthLocationId
      ? `GHL OAuth connected for location ${oauthLocationId}. Link it to a client account if needed.`
      : "GHL OAuth connected successfully.";
  } else if (oauth === "error") {
    oauthNotice = `GHL OAuth failed: ${formatGhlOAuthReason(oauthReason)}`;
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

      {oauthDebug ? (
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Latest OAuth callback (safe debug)</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            <li>Request: {oauthDebug.requestId}</li>
            <li>Outcome: {oauthDebug.outcome}</li>
            <li>
              Code / state: {oauthDebug.hasCode ? "yes" : "no"} / {oauthDebug.hasState ? "yes" : "no"}
              {oauthDebug.stateValid === null ? "" : ` (state valid: ${oauthDebug.stateValid ? "yes" : "no"})`}
            </li>
            {oauthDebug.tokenExchangeStatusCode !== null ? (
              <li>Token exchange HTTP: {oauthDebug.tokenExchangeStatusCode}</li>
            ) : null}
            {oauthDebug.tokenExchangeError ? (
              <li>Token exchange error: {oauthDebug.tokenExchangeError}</li>
            ) : null}
            {oauthDebug.databaseWriteOk !== null ? (
              <li>Database write: {oauthDebug.databaseWriteOk ? "ok" : "failed"}</li>
            ) : null}
            <li>At: {oauthDebug.at}</li>
          </ul>
        </div>
      ) : null}

      <GhlConnectionsTable initialItems={data?.items ?? []} oauthNotice={oauthNotice} />
    </div>
  );
}
