import { GhlConnectionsTable } from "@/components/ghl-connections/ghl-connections-table";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import {
  fetchAdminClients,
  fetchAdminGhlConnections,
  fetchAdminGhlOAuthDebug,
  fetchAdminGhlOAuthPendingInstalls,
  isAdminApiConfigured,
} from "@/lib/admin-api/server";
import { ghlOAuthBannerBorderClass } from "@/lib/ghl-connections/ghl-connection-display";
import type { GhlOAuthPageBanner } from "@/lib/ghl-connections/types";

function formatGhlOAuthReason(reason: string | null): string {
  switch (reason) {
    case "token_exchange_failed":
      return "Token exchange with HighLevel failed. Verify GHL_OAUTH_* env vars and callback URL on the API.";
    case "state_invalid":
      return "OAuth state was missing, invalid, or expired. Start Connect again from this page.";
    case "storage_failed":
      return "Tokens were received but could not be saved. Check API database connectivity and migrations.";
    case "missing_location":
      return "OAuth succeeded but no subaccount locationId was returned. Check pending installs or reinstall.";
    case "missing_code_or_state":
      return "OAuth callback was missing authorization code or state. Start Connect from this page.";
    case "state_missing":
      return "OAuth callback had no state parameter. Use Connect on this page or complete marketplace install.";
    default:
      return reason ?? "Unknown OAuth error.";
  }
}

function resolvePageBanner(input: {
  suggested: GhlOAuthPageBanner | null | undefined;
  urlOauth: string | null;
  urlReason: string | null;
}): GhlOAuthPageBanner | null {
  if (input.urlOauth === "error") {
    return {
      tone: "error",
      message: `GHL OAuth failed: ${formatGhlOAuthReason(input.urlReason)}`,
    };
  }
  return input.suggested ?? null;
}

export default async function GhlConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const configured = isAdminApiConfigured();
  const [connectionsRes, oauthDebugRes, pendingRes, clientsRes] = configured
    ? await Promise.all([
        fetchAdminGhlConnections(),
        fetchAdminGhlOAuthDebug(),
        fetchAdminGhlOAuthPendingInstalls(),
        fetchAdminClients(),
      ])
    : [
        { data: null, error: null as string | null },
        { data: null, error: null as string | null },
        { data: null, error: null as string | null },
        { data: null, error: null as string | null },
      ];
  const oauthDebug = oauthDebugRes.data?.latest ?? null;
  const installWebhook = oauthDebugRes.data?.latestInstallWebhook ?? null;
  const reconciliation = oauthDebugRes.data?.reconciliation ?? null;
  const webhookUrl = oauthDebugRes.data?.marketplaceWebhookUrl ?? null;
  const oauthConfig = oauthDebugRes.data?.config ?? null;

  const oauth = typeof sp.ghl_oauth === "string" ? sp.ghl_oauth : null;
  const oauthReason = typeof sp.reason === "string" ? sp.reason : null;

  const pageBanner = resolvePageBanner({
    suggested: oauthDebugRes.data?.suggestedBanner,
    urlOauth: oauth,
    urlReason: oauthReason,
  });

  const activePending = pendingRes.data?.active ?? pendingRes.data?.items ?? [];
  const reconciledHistory = pendingRes.data?.reconciledHistory ?? [];

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
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p>
              Marketplace webhook URL (API host):{" "}
              <span className="font-mono break-all text-foreground">{webhookUrl}</span>
            </p>
            <p>
              Use this API host webhook URL in the HighLevel Marketplace app. Do not use the Admin
              C.O.C. frontend URL.
            </p>
          </div>
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
            <li>
              Authorize URL includes scope:{" "}
              {oauthConfig.authorizeUrlIncludesScope ? "yes" : "no"}
            </li>
            <li>
              Authorize URL includes state:{" "}
              {oauthConfig.authorizeUrlIncludesState ? "yes" : "no"}
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
              </>
            ) : null}
            {reconciliation ? (
              <>
                <li className="mt-1 font-medium text-foreground">Reconciliation context</li>
                <li>Pending callback received: {reconciliation.pendingCallbackReceived ? "yes" : "no"}</li>
                <li>Install webhook reconciled: {reconciliation.installWebhookReconciled ? "yes" : "no"}</li>
                <li>Connected location created: {reconciliation.connectedLocationCreated ? "yes" : "no"}</li>
                <li>Delivery-capable: {reconciliation.deliveryCapable ? "yes" : "no"}</li>
                {reconciliation.reconciledLocationId ? (
                  <li>Reconciled locationId: {reconciliation.reconciledLocationId}</li>
                ) : null}
              </>
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
            {installWebhook.reconcileNote ? (
              <li>Reconcile: {installWebhook.reconcileNote}</li>
            ) : null}
            <li>At: {installWebhook.at}</li>
          </ul>
        </div>
      ) : null}

      <GhlConnectionsTable
        initialItems={connectionsRes.data?.items ?? []}
        initialPending={activePending}
        reconciledHistory={reconciledHistory}
        pageBanner={pageBanner}
        clients={clientsRes.data?.items ?? []}
      />
    </div>
  );
}
