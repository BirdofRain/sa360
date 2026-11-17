import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  associateClientSourceFunnelAction,
  clearClientSourceFunnelAssociationAction,
  configureClientSourceFunnelLeadTypeAction,
  confirmClientSourceFunnelAction,
  listClientSourceFunnelsAction,
  reassignClientSourceFunnelAction,
} from "@/app/actions/source-funnels";
import { ClientDetailPanel } from "@/components/clients/client-detail-panel";
import {
  ClientDetailLayout,
  ClientDiagnosticsLoading,
  ClientSetupLoading,
  ClientSourceToolsLoading,
  StoredRecordsSection,
} from "@/components/clients/client-detail-layout";
import { ClientSetupPanel } from "@/components/clients/client-setup-panel";
import { LeadCaptureSourcesSection } from "@/components/clients/leadcapture-sources-section";
import { ClientFolderEvidence, OnboardingDiscoveryPanel } from "@/components/clients/onboarding-discovery-panel";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { fetchOnboardingSummary } from "@/lib/admin-api/client-onboarding-v2";
import {
  fetchCompanyGoogleConnection,
  fetchCompanySheetsDestination,
  fetchCompanySheetsDispatch,
  listCompanyClientSpreadsheets,
} from "@/lib/admin-api/company-google-sheets";
import {
  fetchAdminClientCutoverReadiness,
  fetchAdminClientDetail,
  fetchAdminClientSetup,
  isAdminApiConfigured,
  isNativeClientSetupEnabled,
} from "@/lib/admin-api/server";
import { fetchAdminClientSourceFunnels } from "@/lib/admin-api/source-funnels-server";
import { clientDetailDiscoveryInput } from "@/lib/clients/client-detail-discovery";
import { timeClientDetailRead } from "@/lib/clients/client-detail-reads";
import { buildOnboardingDiscovery } from "@/lib/clients/onboarding-discovery";
import type { ClientAccountDetail, ClientSetup } from "@/lib/clients/types";
import { formatClientAccountStatusLabel } from "@/lib/clients/client-account-status-label";
import {
  legacyMasterRoutingApplicability,
  legacyRoutingApplicabilityLabel,
  normalizeCutoverReadinessReport,
  overallStatusBadgeClass,
  overallStatusLabel,
} from "@/lib/clients/cutover-readiness-display";
import { cn } from "@/lib/utils";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ clientAccountId: string }>;
}) {
  const { clientAccountId } = await params;
  const id = decodeURIComponent(clientAccountId);

  if (!isAdminApiConfigured()) {
    return (
      <div className="space-y-4">
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY to load client detail.
        </WarningBanner>
      </div>
    );
  }

  const { data, error } = await timeClientDetailRead("client_detail", () => fetchAdminClientDetail(id));
  if (error) {
    return (
      <div className="space-y-4">
        <WarningBanner tone="warn" title="Could not load client">
          {error}
        </WarningBanner>
        <Link href="/clients" className="text-sm text-sky-700 hover:underline">
          Back to clients
        </Link>
      </div>
    );
  }

  if (!data?.item) notFound();

  const client = data.item;
  const setupEnabled = isNativeClientSetupEnabled();
  const setupPromise = setupEnabled
    ? timeClientDetailRead("client_setup", () => fetchAdminClientSetup(id))
    : Promise.resolve({ data: null, error: null as string | null, status: 0 });
  const readinessPromise = timeClientDetailRead("cutover_readiness", () => fetchAdminClientCutoverReadiness(id));
  const sourcesPromise = timeClientDetailRead("source_funnels", () => fetchAdminClientSourceFunnels(id));
  const sheetsDestinationPromise = timeClientDetailRead("sheets_destination", () =>
    readStored(fetchCompanySheetsDestination(id))
  );
  const googleConnectionPromise = timeClientDetailRead("google_connection", () =>
    readStored(fetchCompanyGoogleConnection())
  );
  const sheetsDispatchPromise = timeClientDetailRead("sheets_dispatch", () =>
    readStored(fetchCompanySheetsDispatch(id))
  );
  const onboardingSummaryPromise = timeClientDetailRead("onboarding_summary", () =>
    readStored(fetchOnboardingSummary(id))
  );
  const folderListingPromise = timeClientDetailRead("folder_spreadsheets", () =>
    readStored(listCompanyClientSpreadsheets(id))
  );

  return (
    <ClientDetailLayout
      clientAccountId={id}
      clientDisplayName={client.clientDisplayName}
      statusLabel={formatClientAccountStatusLabel(client.status)}
      setupEnabled={setupEnabled}
      setup={
        <Suspense fallback={<ClientSetupLoading />}>
          <ClientSetupRegion client={client} setupEnabled={setupEnabled} setupPromise={setupPromise} />
        </Suspense>
      }
      diagnostics={
        <Suspense fallback={<ClientDiagnosticsLoading />}>
          <ClientDiagnosticsRegion
            client={client}
            clientAccountId={id}
            setupEnabled={setupEnabled}
            setupPromise={setupPromise}
            readinessPromise={readinessPromise}
            sourcesPromise={sourcesPromise}
            sheetsDestinationPromise={sheetsDestinationPromise}
            googleConnectionPromise={googleConnectionPromise}
            sheetsDispatchPromise={sheetsDispatchPromise}
            onboardingSummaryPromise={onboardingSummaryPromise}
            folderListingPromise={folderListingPromise}
          />
        </Suspense>
      }
      advancedSources={
        <Suspense fallback={<ClientSourceToolsLoading />}>
          <ClientSourceTools client={client} sourcesPromise={sourcesPromise} />
        </Suspense>
      }
      advancedClient={<ClientDetailPanel initialClient={client} />}
    />
  );
}

async function ClientSetupRegion({
  client,
  setupEnabled,
  setupPromise,
}: {
  client: ClientAccountDetail;
  setupEnabled: boolean;
  setupPromise: Promise<{ data: { item: ClientSetup } | null; error: string | null }>;
}) {
  if (!setupEnabled) {
    return (
      <WarningBanner tone="info" title="Native client setup is disabled">
        Existing client configuration remains available below. Enable the server-side rollout flag
        to use the new setup workflow.
      </WarningBanner>
    );
  }
  const setup = await setupPromise;
  if (setup.data?.item) {
    return <ClientSetupPanel client={client} initialSetup={setup.data.item} />;
  }
  return (
    <WarningBanner tone="warn" title="Could not load client setup">
      {setup.error ?? "Setup data is unavailable."}
    </WarningBanner>
  );
}

async function ClientSourceTools({
  client,
  sourcesPromise,
}: {
  client: ClientAccountDetail;
  sourcesPromise: ReturnType<typeof fetchAdminClientSourceFunnels>;
}) {
  const sources = await sourcesPromise;
  return (
    <LeadCaptureSourcesSection
      clientAccountId={client.clientAccountId}
      clientDisplayName={client.clientDisplayName}
      initialItems={sources.data?.items ?? []}
      loadError={sources.error}
      listAction={listClientSourceFunnelsAction}
      associateAction={associateClientSourceFunnelAction}
      confirmAction={confirmClientSourceFunnelAction}
      reassignAction={reassignClientSourceFunnelAction}
      clearAction={clearClientSourceFunnelAssociationAction}
      configureLeadTypeAction={configureClientSourceFunnelLeadTypeAction}
    />
  );
}

async function ClientDiagnosticsRegion({
  client,
  clientAccountId,
  setupEnabled,
  setupPromise,
  readinessPromise,
  sourcesPromise,
  sheetsDestinationPromise,
  googleConnectionPromise,
  sheetsDispatchPromise,
  onboardingSummaryPromise,
  folderListingPromise,
}: {
  client: ClientAccountDetail;
  clientAccountId: string;
  setupEnabled: boolean;
  setupPromise: Promise<{ data: { item: ClientSetup } | null; error: string | null }>;
  readinessPromise: ReturnType<typeof fetchAdminClientCutoverReadiness>;
  sourcesPromise: ReturnType<typeof fetchAdminClientSourceFunnels>;
  sheetsDestinationPromise: Promise<Awaited<ReturnType<typeof fetchCompanySheetsDestination>> | null>;
  googleConnectionPromise: Promise<Awaited<ReturnType<typeof fetchCompanyGoogleConnection>> | null>;
  sheetsDispatchPromise: Promise<Awaited<ReturnType<typeof fetchCompanySheetsDispatch>> | null>;
  onboardingSummaryPromise: Promise<Awaited<ReturnType<typeof fetchOnboardingSummary>> | null>;
  folderListingPromise: Promise<Awaited<ReturnType<typeof listCompanyClientSpreadsheets>> | null>;
}) {
  const [readiness, sources, setup, sheetsDestination, googleConnection, sheetsDispatch, onboardingSummary] =
    await Promise.all([
      readinessPromise,
      sourcesPromise,
      setupPromise,
      sheetsDestinationPromise,
      googleConnectionPromise,
      sheetsDispatchPromise,
      onboardingSummaryPromise,
    ]);
  const cutoverReport = normalizeCutoverReadinessReport(readiness.data?.report);
  return (
    <>
      {cutoverReport ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Legacy / master-routed cutover readiness
          </span>
          <Badge
            variant="outline"
            className={cn("w-fit", overallStatusBadgeClass(cutoverReport.overallStatus))}
          >
            {overallStatusLabel(cutoverReport.overallStatus)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {cutoverReport.blockers.length} blocker(s), {cutoverReport.warnings.length} warning(s)
          </span>
          <span className="w-full text-xs text-muted-foreground">
            This status is the legacy master-source report. Routing-rule applicability:{" "}
            {legacyRoutingApplicabilityLabel(legacyMasterRoutingApplicability(cutoverReport))}. GHL destination
            readiness is on the destination configuration page.
          </span>
          <Link
            href={`/clients/${encodeURIComponent(clientAccountId)}/delivery-config`}
            className="ml-auto text-xs text-sky-700 hover:underline"
          >
            View full readiness →
          </Link>
        </div>
      ) : readiness.error ? (
        <WarningBanner tone="warn" title="Cutover readiness could not be loaded">
          {readiness.error} This is not a finding that the client is unconfigured.
        </WarningBanner>
      ) : null}
      <StoredRecordsSection>
        <OnboardingDiscoveryPanel
          clientAccountId={clientAccountId}
          model={buildDiscoveryModel({
            client,
            sources,
            setupEnabled,
            setup,
            sheetsDestination,
            googleConnection,
            sheetsDispatch,
            onboardingSummary,
          })}
          folderRead={
            <Suspense fallback={<FolderListingFallback />}>
              <ClientFolderListing listing={folderListingPromise} />
            </Suspense>
          }
        />
      </StoredRecordsSection>
    </>
  );
}

function FolderListingFallback() {
  return (
    <p className="mt-2 text-xs text-slate-600" role="status">
      Loading spreadsheets in the client folder…
    </p>
  );
}

async function ClientFolderListing({
  listing,
}: {
  listing: Promise<Awaited<ReturnType<typeof listCompanyClientSpreadsheets>> | null>;
}) {
  const listed = await listing;
  if (!listed?.ok) {
    return (
      <ClientFolderEvidence
        availability="unavailable"
        title={null}
        spreadsheets={null}
        currentSpreadsheetId={null}
        superseded={[]}
      />
    );
  }
  const currentId = listed.data.currentDestination?.spreadsheetId ?? null;
  return (
    <ClientFolderEvidence
      availability="ready"
      title={listed.data.folder?.title ?? null}
      spreadsheets={(listed.data.spreadsheets ?? []).map((sheet) => ({
        spreadsheetId: sheet.spreadsheetId,
        title: sheet.title,
        url: sheet.url,
      }))}
      currentSpreadsheetId={currentId}
      superseded={(listed.data.links ?? [])
        .filter((link) => link.supersededAt && link.spreadsheetId !== currentId)
        .map((link) => ({
          spreadsheetId: link.spreadsheetId,
          title: link.spreadsheetTitle,
          supersededAt: link.supersededAt,
        }))}
    />
  );
}

async function readStored<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

function buildDiscoveryModel(input: {
  client: ClientAccountDetail;
  sources: Awaited<ReturnType<typeof fetchAdminClientSourceFunnels>>;
  setupEnabled: boolean;
  setup: { data: { item: ClientSetup } | null; error: string | null };
  sheetsDestination: Awaited<ReturnType<typeof fetchCompanySheetsDestination>> | null;
  googleConnection: Awaited<ReturnType<typeof fetchCompanyGoogleConnection>> | null;
  sheetsDispatch: Awaited<ReturnType<typeof fetchCompanySheetsDispatch>> | null;
  onboardingSummary: Awaited<ReturnType<typeof fetchOnboardingSummary>> | null;
}) {
  return buildOnboardingDiscovery(clientDetailDiscoveryInput(input));
}
