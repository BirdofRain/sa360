import type { OnboardingDiscoveryInput } from "@/lib/clients/onboarding-discovery";
import type { OnboardingGate, OnboardingSummary } from "@/lib/clients/onboarding/types";
import type { SourceFunnelAdminItem } from "@/lib/clients/source-funnels";
import type { ClientAccountDetail, ClientSetup } from "@/lib/clients/types";

type ReadOk<T> = { ok: true; data: T };
type ReadFailed = { ok: false; error?: string; status?: number };
type StoredRead<T> = ReadOk<T> | ReadFailed | null;

export type ClientDetailDiscoveryInput = {
  client: ClientAccountDetail;
  sources: { data: { items: SourceFunnelAdminItem[] } | null; error: string | null };
  setupEnabled: boolean;
  setup: { data: { item: ClientSetup } | null; error: string | null };
  sheetsDestination: StoredRead<{
    destination: {
      spreadsheetId: string;
      spreadsheetTitle: string | null;
      spreadsheetUrl: string;
      worksheetTitle: string;
      accessStatus: string;
      writeReadiness: string;
      destinationRevision?: number | null;
      sharing?: {
        intendedRecipientEmail?: string | null;
        clientGooglePermission?: string | null;
      } | null;
    } | null;
  }> | null;
  googleConnection: StoredRead<{
    connection: {
      googleEmail: string | null;
      status: string;
      destinationFolder?: { title?: string | null } | null;
    };
  }> | null;
  sheetsDispatch: StoredRead<{
    campaignDispatchEnabled: boolean;
    agedDispatchEnabled: boolean;
  }> | null;
  onboardingSummary: StoredRead<OnboardingSummary> | { ok: false; error: string; status?: number } | null;
};

export function clientDetailDiscoveryInput(input: ClientDetailDiscoveryInput): OnboardingDiscoveryInput {
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
  summary: ClientDetailDiscoveryInput["onboardingSummary"]
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
