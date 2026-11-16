import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  associateClientSourceFunnelAction,
  clearClientSourceFunnelAssociationAction,
  confirmClientSourceFunnelAction,
  listClientSourceFunnelsAction,
  reassignClientSourceFunnelAction,
} from "@/app/actions/source-funnels";
import { ClientDetailPanel } from "@/components/clients/client-detail-panel";
import { ClientDetailSetupLink } from "@/components/clients/onboarding/client-detail-setup-link";
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
import {
  buildOnboardingDiscovery,
  type OnboardingDiscoveryInput,
} from "@/lib/clients/onboarding-discovery";
import type { OnboardingGate, OnboardingSummary } from "@/lib/clients/onboarding/types";
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

  const { data, error } = await fetchAdminClientDetail(id);
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

  const setupEnabled = isNativeClientSetupEnabled();
  const [readiness, sources, setup, sheetsDestination, googleConnection, sheetsDispatch, onboardingSummary] =
    await Promise.all([
      fetchAdminClientCutoverReadiness(id),
      fetchAdminClientSourceFunnels(id),
      setupEnabled
        ? fetchAdminClientSetup(id)
        : Promise.resolve({ data: null, error: null as string | null }),
      readStored(fetchCompanySheetsDestination(id)),
      readStored(fetchCompanyGoogleConnection()),
      readStored(fetchCompanySheetsDispatch(id)),
      readStored(fetchOnboardingSummary(id)),
    ]);
  const readinessData = readiness.data;
  const cutoverReport = normalizeCutoverReadinessReport(readinessData?.report);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/clients" className="text-xs text-sky-700 hover:underline">
          ← All clients
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{data.item.clientDisplayName}</h1>
        <p className="font-mono text-sm text-muted-foreground">{data.item.clientAccountId}</p>
        <div className="mt-2">
          <Badge variant="outline">{formatClientAccountStatusLabel(data.item.status)}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <Link
            href={`/clients/${encodeURIComponent(id)}/settings`}
            className="text-sky-700 hover:underline"
          >
            Channel Profile settings →
          </Link>
          <Link
            href={`/clients/${encodeURIComponent(id)}/delivery-config`}
            className="text-sky-700 hover:underline"
          >
            GHL destination configuration →
          </Link>
          <Link
            href={`/clients/${encodeURIComponent(id)}/google-sheets`}
            className="text-sky-700 hover:underline"
          >
            Company Google Sheets →
          </Link>
          <Link
            href={`/clients/${encodeURIComponent(id)}/notification-recipient`}
            className="text-sky-700 hover:underline"
          >
            Delivery notification recipient →
          </Link>
          <ClientDetailSetupLink clientAccountId={id} />
        </div>
      </div>
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
            href={`/clients/${encodeURIComponent(id)}/delivery-config`}
            className="ml-auto text-xs text-sky-700 hover:underline"
          >
            View full readiness →
          </Link>
        </div>
      ) : null}
      <OnboardingDiscoveryPanel
        clientAccountId={id}
        model={buildOnboardingDiscovery(
          discoveryInput({
            client: data.item,
            sources,
            setupEnabled,
            setup,
            sheetsDestination,
            googleConnection,
            sheetsDispatch,
            onboardingSummary,
          })
        )}
        folderRead={
          <Suspense fallback={<FolderListingFallback />}>
            <ClientFolderListing clientAccountId={id} />
          </Suspense>
        }
      />
      {setupEnabled && setup.data?.item ? (
        <ClientSetupPanel client={data.item} initialSetup={setup.data.item} />
      ) : setupEnabled ? (
        <WarningBanner tone="warn" title="Could not load client setup">
          {setup.error ?? "Setup data is unavailable."}
        </WarningBanner>
      ) : (
        <WarningBanner tone="info" title="Native client setup is disabled">
          Existing client configuration remains available below. Enable the server-side rollout flag
          to use the new setup workflow.
        </WarningBanner>
      )}
      <details
        id="advanced-configuration"
        open={!setupEnabled}
        className="rounded-xl border border-slate-200 bg-slate-50"
      >
        <summary className="cursor-pointer px-4 py-3 text-sm text-slate-900">
          <span className="font-semibold">Advanced configuration</span>
          <span className="mt-1 block text-xs font-normal text-slate-600">
            Associate sources, confirm ownership, or edit the client record. These tools can write
            operational records. The summary above does not.
          </span>
        </summary>
        <div className="space-y-4 border-t border-slate-200 p-4">
          <LeadCaptureSourcesSection
            clientAccountId={id}
            clientDisplayName={data.item.clientDisplayName}
            initialItems={sources.data?.items ?? []}
            loadError={sources.error}
            listAction={listClientSourceFunnelsAction}
            associateAction={associateClientSourceFunnelAction}
            confirmAction={confirmClientSourceFunnelAction}
            reassignAction={reassignClientSourceFunnelAction}
            clearAction={clearClientSourceFunnelAssociationAction}
          />
          <ClientDetailPanel initialClient={data.item} />
        </div>
      </details>
    </div>
  );
}

function FolderListingFallback() {
  return (
    <p className="mt-2 text-xs text-slate-600" role="status">
      Loading spreadsheets in the client folder…
    </p>
  );
}

async function ClientFolderListing({ clientAccountId }: { clientAccountId: string }) {
  const listed = await readStored(listCompanyClientSpreadsheets(clientAccountId));
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

function discoveryInput(input: {
  client: ClientAccountDetail;
  sources: Awaited<ReturnType<typeof fetchAdminClientSourceFunnels>>;
  setupEnabled: boolean;
  setup: { data: { item: ClientSetup } | null; error: string | null };
  sheetsDestination: Awaited<ReturnType<typeof fetchCompanySheetsDestination>> | null;
  googleConnection: Awaited<ReturnType<typeof fetchCompanyGoogleConnection>> | null;
  sheetsDispatch: Awaited<ReturnType<typeof fetchCompanySheetsDispatch>> | null;
  onboardingSummary: Awaited<ReturnType<typeof fetchOnboardingSummary>> | null;
}): OnboardingDiscoveryInput {
  const ghl = input.client.ghlDestination;
  const fieldMapping = input.client.destinationReadiness?.fieldMapping;
  const savedDestination = input.sheetsDestination?.ok ? input.sheetsDestination.data.destination : null;
  const connection = input.googleConnection?.ok ? input.googleConnection.data.connection : null;
  const summary = input.onboardingSummary?.ok ? input.onboardingSummary.data : null;
  return {
    client: {
      clientDisplayName: input.client.clientDisplayName,
      createdAt: input.client.createdAt,
      ghlDestination: ghl
        ? {
            destinationSubaccountIdGhl: ghl.destinationSubaccountIdGhl,
            locationName: ghl.locationName,
            ghlConnectionStatus: ghl.ghlConnectionStatus,
            deliveryEnabled: ghl.deliveryEnabled,
            fieldMappingComplete: fieldMapping ? fieldMapping.coreRequiredComplete : null,
          }
        : null,
      routingRules: (input.client.routingRules ?? []).map((rule) => ({
        id: rule.id,
        campaignId: rule.campaignId,
        campaignName: rule.campaignName,
        utmCampaign: rule.utmCampaign,
        active: rule.active,
        deliveryEnabled: rule.deliveryEnabled,
      })),
    },
    sources: input.sources.data
      ? { availability: "ready", items: input.sources.data.items }
      : { availability: "unavailable", items: [] },
    setup: setupRead(input.setupEnabled, input.setup.data?.item ?? null),
    sheetsDestination: input.sheetsDestination?.ok
      ? {
          availability: "ready",
          destination: savedDestination
            ? {
                spreadsheetId: savedDestination.spreadsheetId,
                spreadsheetTitle: savedDestination.spreadsheetTitle,
                spreadsheetUrl: savedDestination.spreadsheetUrl,
                worksheetTitle: savedDestination.worksheetTitle,
                accessStatus: savedDestination.accessStatus,
                writeReadiness: savedDestination.writeReadiness,
                revision: savedDestination.destinationRevision ?? null,
                sharingEmail: savedDestination.sharing?.intendedRecipientEmail ?? null,
                sharingPermission: savedDestination.sharing?.clientGooglePermission ?? null,
              }
            : null,
        }
      : { availability: "unavailable", destination: null },
    googleConnection: connection
      ? {
          availability: "ready",
          email: connection.googleEmail,
          connectionStatus: connection.status,
          rootFolderTitle: connection.destinationFolder?.title ?? null,
        }
      : { availability: "unavailable", email: null, connectionStatus: null, rootFolderTitle: null },
    clientFolder: { availability: "deferred", title: null, url: null, spreadsheets: [], links: [] },
    sheetsDispatch: input.sheetsDispatch?.ok
      ? {
          availability: "ready",
          campaignDispatchEnabled: input.sheetsDispatch.data.campaignDispatchEnabled,
          agedDispatchEnabled: input.sheetsDispatch.data.agedDispatchEnabled,
        }
      : { availability: "unavailable", campaignDispatchEnabled: false, agedDispatchEnabled: false },
    sourceProof: summary ? proofFromSummary(summary) : disabledOrUnavailable(input.onboardingSummary),
  };
}

function setupRead(enabled: boolean, item: ClientSetup | null): OnboardingDiscoveryInput["setup"] {
  if (!enabled) return { availability: "disabled", status: null, revision: null, destinationChoice: null };
  if (!item) return { availability: "unavailable", status: null, revision: null, destinationChoice: null };
  return {
    availability: "ready",
    status: item.status,
    revision: item.revision,
    destinationChoice: item.data.destinationChoice ?? null,
    operatorNotes: {
      webhookConfigured: item.data.webhookConfigured === true,
      sourceTestSubmitted: item.data.sourceTestSubmitted === true,
      setupReviewed: item.status === "setup_reviewed",
    },
  };
}

function proofFromSummary(summary: OnboardingSummary): OnboardingDiscoveryInput["sourceProof"] {
  const published = gateSatisfied(summary.gates, "sheets_custom_map_published");
  const header = gateSatisfied(summary.gates, "sheets_header_dispatch_ready");
  const writer = gateSatisfied(summary.gates, "sheets_writer_receipt");
  return {
    availability: "ready",
    evidenceTruncated: summary.evidenceTruncated === true,
    sources: (summary.sources ?? []).map((source) => ({
      sourceFunnelId: source.sourceFunnelId,
      sourceKind: source.sourceKind,
      observedEventId: source.proofs.observed.sourceLeadEventId,
      observedAt: source.proofs.observed.at ?? null,
      matchedRuleId: source.proofs.routingMatched.matchedRuleId,
      deliverySatisfied: source.proofs.delivery.satisfied,
    })),
    fieldMapVerified: published == null && header == null ? null : Boolean(published || header),
    writerReceiptVerified: writer,
  };
}

function disabledOrUnavailable(
  summary: Awaited<ReturnType<typeof fetchOnboardingSummary>> | null
): OnboardingDiscoveryInput["sourceProof"] {
  const disabled = Boolean(summary && !summary.ok && summary.error === "onboarding_read_disabled");
  return {
    availability: disabled ? "disabled" : "unavailable",
    evidenceTruncated: false,
    sources: [],
    fieldMapVerified: null,
    writerReceiptVerified: null,
  };
}

function gateSatisfied(gates: OnboardingGate[] | undefined, id: string): boolean | null {
  const gate = (gates ?? []).find((item) => item.id === id);
  return gate ? gate.satisfied : null;
}
