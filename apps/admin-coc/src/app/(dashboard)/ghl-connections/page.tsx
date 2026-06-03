import { GhlConnectionsTable } from "@/components/ghl-connections/ghl-connections-table";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import {
  fetchAdminGhlConnections,
  fetchAdminGhlOAuthDebug,
  fetchAdminGhlOAuthPendingInstalls,
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
      return "OAuth succeeded but no subaccount locationId was returned. A pending install may have been stored — check Pending OAuth below.";
    case "missing_code_or_state":
      return "OAuth callback was missing authorization code or state. Start Connect from this page.";
    case "state_missing":
      return "OAuth callback had no state parameter. Use Connect on this page or complete marketplace install.";
    default:
      return reason ?? "Unknown OAuth error.";
  }
}

function formatGhlOAuthStatus(oauth: string | null): string | null {
  if (oauth === "connected_unlinked") {
    return "GHL OAuth connected (unlinked). Link the new location to a client account below.";
  }
  if (oauth === "pending_location") {
    return "GHL OAuth tokens saved as pending — awaiting subaccount locationId from marketplace INSTALL webhook.";
  }
  return null;
}

export default async function GhlConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const configured = isAdminApiConfigured();
  const [connectionsRes, oauthDebugRes, pendingRes] = configured
    ? await Promise.all([
        fetchAdminGhlConnections(),
        fetchAdminGhlOAuthDebug(),
        fetchAdminGhlOAuthPendingInstalls(),
      ])
    : [
        { data: null, error: null as string | null },
        { data: null, error: null as string | null },
        { data: null, error: null as string | null },
      ];
  const oauthDebug = oauthDebugRes.data?.latest ?? null;
  const installWebhook = oauthDebugRes.data?.latestInstallWebhook ?? null;
  const webhookUrl = oauthDebugRes.data?.marketplaceWebhookUrl ?? null;
  const oauthConfig = oauthDebugRes.data?.config ?? null;

  const oauth = typeof sp.ghl_oauth === "string" ? sp.ghl_oauth : null;
  const oauthReason = typeof sp.reason === "string" ? sp.reason : null;
  const oauthLocationId = typeof sp.locationId === "string" ? sp.locationId : null;

  let oauthNotice: string | null = null;
  const statusNotice = formatGhlOAuthStatus(oauth);
  if (statusNotice) {
    oauthNotice =
      oauth === "pending_location" || !oauthLocationId
        ? statusNotice
        : `${statusNotice} Location: ${oauthLocationId}.`;
  } else if (oauth === "connected") {
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
        {webhookUrl ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Marketplace webhook URL (API host):{" "}
            <span className="font-mono break-all text-foreground">{webhookUrl}</span>
          </p>
        ) : null}
      </div>

      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY to manage GHL connections.
        </WarningBanner>
      ) : null}

      {connectionsRes.error ? (
        <WarningBanner tone="warn" title="Could not load connections">
          {connectionsRes.error}
        </WarningBanner>
      ) : null}

      {oauthConfig ? (
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">OAuth install config (safe)</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            <li>Client ID: {oauthConfig.hasClientId ? "set" : "missing"}</li>
            <li>Redirect URI: {oauthConfig.hasRedirectUri ? "set" : "missing"}</li>
            <li>Scopes: {oauthConfig.hasScopes ? "set" : "missing"}</li>
            <li>Version ID: {oauthConfig.hasVersionId ? "set" : "missing"}</li>
            <li>
              Authorize URL includes version_id:{" "}
              {oauthConfig.authorizeUrlIncludesVersionId ? "yes" : "no"}
            </li>
          </ul>
        </div>
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
            {oauthDebug.tokenLevel ? <li>Token level: {oauthDebug.tokenLevel}</li> : null}
            {oauthDebug.tokenResponseShape ? (
              <>
                <li>userType: {oauthDebug.tokenResponseShape.userType ?? "—"}</li>
                <li>companyId present: {oauthDebug.tokenResponseShape.companyIdPresent ? "yes" : "no"}</li>
                <li>locationId present: {oauthDebug.tokenResponseShape.locationIdPresent ? "yes" : "no"}</li>
                <li>userId present: {oauthDebug.tokenResponseShape.userIdPresent ? "yes" : "no"}</li>
                <li>scope present: {oauthDebug.tokenResponseShape.scopePresent ? "yes" : "no"}</li>
              </>
            ) : null}
            {oauthDebug.pendingInstallId ? (
              <li>Pending install id: {oauthDebug.pendingInstallId}</li>
            ) : null}
            {oauthDebug.databaseWriteOk !== null ? (
              <li>Database write: {oauthDebug.databaseWriteOk ? "ok" : "failed"}</li>
            ) : null}
            <li>At: {oauthDebug.at}</li>
          </ul>
        </div>
      ) : null}

      {installWebhook ? (
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Latest INSTALL webhook (safe debug)</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            <li>Event: {installWebhook.eventType ?? "—"}</li>
            <li>Handled: {installWebhook.handled ? "yes" : "no"}</li>
            <li>locationId present: {installWebhook.locationIdPresent ? "yes" : "no"}</li>
            <li>companyId present: {installWebhook.companyIdPresent ? "yes" : "no"}</li>
            <li>appId present: {installWebhook.appIdPresent ? "yes" : "no"}</li>
            <li>versionId present: {installWebhook.versionIdPresent ? "yes" : "no"}</li>
            {installWebhook.reconcileNote ? (
              <li>Reconcile: {installWebhook.reconcileNote}</li>
            ) : null}
            <li>At: {installWebhook.at}</li>
          </ul>
        </div>
      ) : null}

      <GhlConnectionsTable
        initialItems={connectionsRes.data?.items ?? []}
        initialPending={pendingRes.data?.items ?? []}
        oauthNotice={oauthNotice}
      />
    </div>
  );
}
