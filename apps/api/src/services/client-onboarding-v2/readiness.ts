/**
 * Client onboarding summary from records that already exist.
 * Postgres only. This GET does not call Google, GHL, Meta, or LeadCapture.
 */

import type { PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  COMPANY_SHEETS_WRITE_READINESS_VERIFIED,
  companySheetsCampaignHeader,
  isCompanyGoogleSheetsDispatchEnabled,
  isCompanyGoogleSheetsEnabled,
  isCompanyGoogleSheetsExecutionEnabled,
} from "../../lib/company-google-sheets-env.js";
import {
  COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
  exactHeader,
  headerFingerprint,
} from "../company-sheets-delivery/company-sheets-custom-row.js";
import {
  isCapturedTestEnabled,
  isOnboardingConfigEnabled,
} from "./captured-test-delivery.js";
import { findPublishedColumnMap } from "./column-maps.js";
import { ONBOARDING_GHL_TEST_ADAPTER_APPROVED_FLAG } from "./onboarding-ghl-test-adapter.js";
import { clientOnboardingSetupDataSchema } from "../../schemas/client-onboarding-setup.schema.js";
import {
  findProductionSheetsDelivery,
  readClientSourceProof,
  type OnboardingSourceProof,
  type ProofIntent,
  type ProofJob,
} from "./source-proof.js";

export const CLIENT_ONBOARDING_V2_CONTRACT = "client_onboarding_v2" as const;

const GATE_IDS = [
  "leadcapture_linked",
  "leadcapture_observed",
  "leadcapture_routing_matched",
  "meta_capture_only_acknowledged",
  "meta_linked",
  "meta_routing_matched",
  "sheets_destination_saved",
  "sheets_control_verified",
  "sheets_tab_explicitly_bound",
  "sheets_header_dispatch_ready",
  "sheets_custom_map_published",
  "sheets_permission_probe",
  "sheets_writer_receipt",
  "sheets_no_uncertain_job",
  "ghl_mode_explicit",
  "ghl_location_configured",
  "ghl_webhook_stored_disabled",
  "ghl_note_contract_ready",
  "zapier_not_disabled",
  "aged_not_activated_by_onboarding",
] as const;

export type OnboardingGateId = (typeof GATE_IDS)[number];

export type OnboardingGate = {
  id: OnboardingGateId;
  /** Prerequisites can block first activation. Evidence is reported after activation and cannot. */
  role: "prerequisite" | "evidence";
  required: boolean;
  satisfied: boolean;
  evidenceIds: string[];
};

export type BoundCampaignHeaderAssessment = {
  preset: boolean;
  headerReady: boolean;
  customMapMatches: boolean;
};

/**
 * Preset tabs are ready only when the bound header equals that schema's header.
 * Custom tabs are ready only when a published map is bound to this spreadsheet
 * and worksheet and its header fingerprint equals the bound header.
 * The bound headerContract is the live dispatch header. This read does not call Google.
 */
export function assessBoundCampaignHeader(input: {
  schemaVersion: string | null | undefined;
  setupState: string | null | undefined;
  header: readonly string[] | null;
  spreadsheetId: string | null;
  worksheetId: number | null;
  publishedMap: { spreadsheetId: string; worksheetId: number; headerSnapshot: readonly string[] } | null;
}): BoundCampaignHeaderAssessment {
  const bound = input.setupState === "bound" && input.header != null && input.worksheetId != null;
  const presetHeader = companySheetsCampaignHeader(input.schemaVersion);
  if (presetHeader) {
    return {
      preset: true,
      headerReady: Boolean(bound && exactHeader(input.header ?? [], presetHeader)),
      customMapMatches: false,
    };
  }
  const targetBound = Boolean(
    input.publishedMap &&
      input.spreadsheetId &&
      input.spreadsheetId === input.publishedMap.spreadsheetId &&
      input.worksheetId != null &&
      input.worksheetId === input.publishedMap.worksheetId
  );
  const fingerprintMatches = Boolean(
    targetBound &&
      input.header &&
      input.publishedMap &&
      headerFingerprint(input.header) === headerFingerprint(input.publishedMap.headerSnapshot)
  );
  const custom = input.schemaVersion === COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA;
  return {
    preset: false,
    headerReady: Boolean(custom && bound && fingerprintMatches),
    customMapMatches: Boolean(custom && fingerprintMatches),
  };
}

/**
 * First activation ignores a production lead receipt. A verified probe is current
 * only while the bound header is still ready; header drift makes that evidence stale.
 * Custom execution still requires the custom writer flag. Preset tabs do not.
 */
export function sheetsFirstActivationReady(input: {
  preset: boolean;
  headerReady: boolean;
  customWriterEnabled: boolean;
  writeReadiness: string | null;
  controlledTestSucceeded: boolean;
  uncertainJobs: number;
  controlSelectable: boolean;
}): boolean {
  const contractReady = input.preset ? input.headerReady : input.headerReady && input.customWriterEnabled;
  const permissionCurrent = input.writeReadiness === COMPANY_SHEETS_WRITE_READINESS_VERIFIED && input.headerReady;
  return (
    contractReady &&
    permissionCurrent &&
    input.controlledTestSucceeded &&
    input.uncertainJobs === 0 &&
    input.controlSelectable
  );
}

export type OnboardingReadFailure = { ok: false; code: string; statusCode: number };

export function isClientOnboardingV2ReadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_CLIENT_ONBOARDING_V2_READ_ENABLED?.trim() === "true";
}

export async function readClientOnboardingSummary(
  clientAccountId: string,
  db: PrismaClient = prisma,
  env: NodeJS.ProcessEnv = process.env
): Promise<
  | {
      ok: true;
      contractVersion: typeof CLIENT_ONBOARDING_V2_CONTRACT;
      client: {
        clientAccountId: string;
        clientDisplayName: string;
        status: string;
        primaryNicheKeys: string[];
        primaryProductTypes: string[];
      };
      setupRequest: {
        present: boolean;
        status: string | null;
        revision: number;
        destinationChoice: string | null;
        operational: false;
      };
      sources: OnboardingSourceProof[];
      evidenceTruncated: boolean;
      sheets: {
        destinationSaved: boolean;
        spreadsheetId: string | null;
        spreadsheetTitle: string | null;
        campaignTab: string | null;
        campaignDispatchEnabled: boolean;
        campaignDispatchNotBefore: string | null;
        agedDispatchEnabled: boolean;
        writeReadiness: string | null;
        deliveryExecution: string | null;
        uncertainJob: boolean;
      };
      ghl: {
        mode: "unset" | "location_api" | "inbound_webhook" | "external_zapier";
        locationIdPresent: boolean;
        workflowTriggerMode: string | null;
        workflowIdPresent: boolean;
        inboundWebhookArmed: boolean;
        notesEnabled: boolean;
        notesContractVersion: string | null;
      };
      externalZapier: { preserved: true; replacedByNative: false };
      destinationProfile: {
        present: boolean;
        /** 0 is the create token. A stored profile returns its real revision. */
        revision: number;
        sheetsSelected: boolean;
        ghlMode: "unset" | "location_api" | "inbound_webhook" | "external_zapier";
        notesEnabled: boolean;
      };
      runtime: {
        onboardingReadEnabled: boolean;
        onboardingConfigEnabled: boolean;
        capturedTestEnabled: boolean;
        ghlLocationTestAdapterApproved: boolean;
        ghlProductionHostAllowed: false;
        companySheetsEnabled: boolean;
        companySheetsExecutionEnabled: boolean;
        companySheetsDispatchEnabled: boolean;
        activationEnabled: false;
        clientStatus: string;
      };
      gates: OnboardingGate[];
      liveActivationPerformedByOnboarding: false;
      blockers: OnboardingGateId[];
    }
  | OnboardingReadFailure
> {
  const client = await db.clientAccount.findUnique({
    where: { clientAccountId },
    include: {
      onboardingSetup: true,
      onboardingDestinationProfile: true,
      ghlDestination: true,
      companySheetsDestination: { include: { tabContracts: true } },
    },
  });
  if (!client) return { ok: false, code: "client_not_found", statusCode: 404 };
  const [proof, jobs, intents, webhookTargets, uncertainJobs] = await Promise.all([
    readClientSourceProof(client.clientAccountId, db),
    db.companySheetsDeliveryJob.findMany({
      where: { clientAccountId: client.clientAccountId },
      select: { id: true, kind: true, status: true, sourceLeadEventId: true, clientAccountId: true },
      take: 2000,
    }),
    db.companySheetsDispatchIntent.findMany({
      where: { clientAccountId: client.clientAccountId, kind: "campaign_lead" },
      select: { sourceLeadEventId: true, kind: true, createdAt: true, clientAccountId: true },
      take: 2000,
    }),
    db.deliveryTarget.findMany({
      where: { clientAccountId: client.clientAccountId, adapterKey: "webhook.generic.v1" },
      select: { id: true, enabled: true, isPrimary: true, isRequired: true },
    }),
    db.companySheetsDeliveryJob.count({
      where: { clientAccountId: client.clientAccountId, status: "uncertain" },
    }),
  ]);
  const setupData = client.onboardingSetup
    ? clientOnboardingSetupDataSchema.safeParse(client.onboardingSetup.setupDataJson)
    : null;
  const destinationChoice = setupData?.success ? (setupData.data.destinationChoice ?? null) : null;
  const sourceProvider = setupData?.success ? (setupData.data.sourceProvider ?? null) : null;
  const destination = client.companySheetsDestination;
  const campaign = destination?.tabContracts.find((contract) => contract.role === "campaign") ?? null;
  const profile = client.onboardingDestinationProfile;
  const profileMode = isProfileGhlMode(profile?.ghlMode);
  const sheetsSelected = profile
    ? profile.sheetsSelected
    : destinationChoice === "google_sheets" || destinationChoice === "both";
  const ghlSelected = profile
    ? profile.ghlMode === "location_api" || profile.ghlMode === "inbound_webhook"
    : destinationChoice === "ghl" || destinationChoice === "both";
  const locationIdPresent = Boolean(client.ghlDestination?.destinationSubaccountIdGhl?.trim());
  const inboundWebhookArmed = webhookTargets.some((target) => target.enabled);
  const mode = profileMode ?? (locationIdPresent ? "location_api" : "unset");
  const notesEnabled = profile?.notesEnabled ?? false;
  const notesContractVersion = profile?.notesContractVersion ?? null;
  const header = stringArray(campaign?.headerContract);
  const publishedMap = destination
    ? await findPublishedColumnMap(db, {
        clientAccountId: client.clientAccountId,
        spreadsheetId: destination.spreadsheetId,
        worksheetId: campaign?.worksheetId ?? -1,
        sourceFunnelId: null,
      })
    : null;
  const publishedHeader = stringArray(publishedMap?.headerSnapshot);
  const headerAssessment = assessBoundCampaignHeader({
    schemaVersion: campaign?.schemaVersion ?? null,
    setupState: campaign?.setupState ?? null,
    header,
    spreadsheetId: destination?.spreadsheetId ?? null,
    worksheetId: campaign?.worksheetId ?? null,
    publishedMap:
      publishedMap && publishedHeader
        ? {
            spreadsheetId: publishedMap.spreadsheetId,
            worksheetId: publishedMap.worksheetId,
            headerSnapshot: publishedHeader,
          }
        : null,
  });
  const customMapRequired = Boolean(
    sheetsSelected &&
      campaign?.setupState === "bound" &&
      campaign.schemaVersion === COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA
  );
  const writerJobId = findProductionSheetsDelivery({
    jobs: jobs as ProofJob[],
    intents: intents as ProofIntent[],
    cutoff: destination?.campaignDispatchNotBefore ?? null,
    clientAccountId: client.clientAccountId,
  });
  const gates = buildGates({
    sources: proof.sources,
    sourceProvider,
    sheetsSelected,
    ghlSelected,
    mode,
    destinationSaved: Boolean(destination),
    controlVerified: destination?.accessStatus === "readable" && Boolean(destination.controlBasis),
    tabBound: campaign?.setupState === "bound" && campaign.worksheetId != null,
    headerReady: headerAssessment.headerReady,
    customMapRequired,
    customMapPublished: headerAssessment.customMapMatches,
    writeReadiness: destination?.writeReadiness ?? null,
    writerJobId,
    uncertainJobs,
    locationIdPresent,
    webhookTargets,
    inboundWebhookArmed,
    notesEnabled,
    noteContractReady: notesEnabled && notesContractVersion === "sa360_lead_note_v2",
    evidence: {
      destinationId: destination?.id ?? null,
      campaignContractId: campaign?.id ?? null,
      webhookIds: webhookTargets.map((target) => target.id),
    },
  });
  return {
    ok: true,
    contractVersion: CLIENT_ONBOARDING_V2_CONTRACT,
    client: {
      clientAccountId: client.clientAccountId,
      clientDisplayName: client.clientDisplayName,
      status: client.status,
      primaryNicheKeys: stringList(client.primaryNicheKeys),
      primaryProductTypes: stringList(client.primaryProductTypes),
    },
    setupRequest: {
      present: Boolean(client.onboardingSetup),
      status: client.onboardingSetup?.status ?? null,
      revision: client.onboardingSetup?.revision ?? 0,
      destinationChoice,
      operational: false,
    },
    sources: proof.sources,
    evidenceTruncated: proof.evidenceTruncated,
    sheets: {
      destinationSaved: Boolean(destination),
      spreadsheetId: destination?.spreadsheetId ?? null,
      spreadsheetTitle: destination?.spreadsheetTitle ?? null,
      campaignTab: campaign?.worksheetTitle ?? null,
      campaignDispatchEnabled: destination?.campaignDispatchEnabled ?? false,
      campaignDispatchNotBefore: destination?.campaignDispatchNotBefore?.toISOString() ?? null,
      agedDispatchEnabled: destination?.agedDispatchEnabled ?? false,
      writeReadiness: destination?.writeReadiness ?? null,
      deliveryExecution: destination?.deliveryExecution ?? null,
      uncertainJob: uncertainJobs > 0,
    },
    ghl: {
      mode,
      locationIdPresent,
      workflowTriggerMode: client.ghlDestination?.workflowTriggerMode ?? null,
      workflowIdPresent: Boolean(client.ghlDestination?.destinationWorkflowIdGhl?.trim()),
      inboundWebhookArmed,
      notesEnabled,
      notesContractVersion,
    },
    externalZapier: { preserved: true, replacedByNative: false },
    destinationProfile: {
      present: Boolean(profile),
      revision: profile?.revision ?? 0,
      sheetsSelected,
      ghlMode: mode,
      notesEnabled,
    },
    runtime: {
      onboardingReadEnabled: isClientOnboardingV2ReadEnabled(env),
      onboardingConfigEnabled: isOnboardingConfigEnabled(env),
      capturedTestEnabled: isCapturedTestEnabled(env),
      ghlLocationTestAdapterApproved: env[ONBOARDING_GHL_TEST_ADAPTER_APPROVED_FLAG] === "true",
      ghlProductionHostAllowed: false,
      companySheetsEnabled: isCompanyGoogleSheetsEnabled(env),
      companySheetsExecutionEnabled: isCompanyGoogleSheetsExecutionEnabled(env),
      companySheetsDispatchEnabled: isCompanyGoogleSheetsDispatchEnabled(env),
      activationEnabled: false,
      clientStatus: client.status,
    },
    gates,
    liveActivationPerformedByOnboarding: false,
    blockers: gates.filter((gate) => gate.required && !gate.satisfied).map((gate) => gate.id),
  };
}

function buildGates(input: {
  sources: OnboardingSourceProof[];
  sourceProvider: string | null;
  sheetsSelected: boolean;
  ghlSelected: boolean;
  mode: "unset" | "location_api" | "inbound_webhook" | "external_zapier";
  destinationSaved: boolean;
  controlVerified: boolean;
  tabBound: boolean;
  headerReady: boolean;
  customMapRequired: boolean;
  customMapPublished: boolean;
  writeReadiness: string | null;
  writerJobId: string | null;
  uncertainJobs: number;
  locationIdPresent: boolean;
  webhookTargets: Array<{ id: string; enabled: boolean; isPrimary: boolean; isRequired: boolean }>;
  inboundWebhookArmed: boolean;
  notesEnabled: boolean;
  noteContractReady: boolean;
  evidence: { destinationId: string | null; campaignContractId: string | null; webhookIds: string[] };
}): OnboardingGate[] {
  const leadcapture = input.sources.filter((source) => source.sourceKind === "leadcapture");
  const meta = input.sources.filter(
    (source) => source.sourceKind === "meta_lead_ads" || source.sourceKind === "zapier_facebook"
  );
  const leadcaptureRequired = leadcapture.length > 0 || input.sourceProvider === "nextgen";
  const metaRequired = meta.length > 0;
  const captureOnly = meta.filter(
    (source) => source.proofs.observed.captureOnly && !source.proofs.routingMatched.satisfied
  );
  const metaRoutingRequired = meta.some((source) => !source.proofs.observed.captureOnly || source.proofs.routingMatched.satisfied);
  const webhookStoredDisabled =
    input.webhookTargets.length === 0 ||
    input.webhookTargets.every((target) => !target.enabled && !target.isPrimary && !target.isRequired);
  const ids = (sources: OnboardingSourceProof[], pick: (source: OnboardingSourceProof) => boolean) =>
    sources.filter(pick).map((source) => source.sourceFunnelId);
  const gate = (
    id: OnboardingGateId,
    required: boolean,
    satisfied: boolean,
    evidenceIds: string[],
    role: OnboardingGate["role"] = "prerequisite"
  ): OnboardingGate => ({ id, role, required, satisfied, evidenceIds });
  return [
    gate("leadcapture_linked", leadcaptureRequired, leadcapture.some((source) => source.proofs.linked.satisfied), ids(leadcapture, (source) => source.proofs.linked.satisfied)),
    gate("leadcapture_observed", leadcaptureRequired, leadcapture.some((source) => source.proofs.observed.satisfied), ids(leadcapture, (source) => source.proofs.observed.satisfied)),
    gate(
      "leadcapture_routing_matched",
      leadcaptureRequired,
      leadcapture.some((source) => source.proofs.routingMatched.satisfied),
      ids(leadcapture, (source) => source.proofs.routingMatched.satisfied)
    ),
    gate(
      "meta_capture_only_acknowledged",
      captureOnly.length > 0,
      captureOnly.length === 0 ||
        captureOnly.every(
          (source) =>
            source.proofs.observed.satisfied &&
            source.proofs.observed.captureOnly &&
            !source.proofs.routingMatched.satisfied &&
            !source.proofs.delivery.satisfied
        ),
      captureOnly.map((source) => source.proofs.observed.sourceLeadEventId).filter((id): id is string => Boolean(id))
    ),
    gate("meta_linked", metaRequired, meta.some((source) => source.proofs.linked.satisfied), ids(meta, (source) => source.proofs.linked.satisfied)),
    gate(
      "meta_routing_matched",
      metaRoutingRequired,
      meta.some((source) => source.proofs.routingMatched.satisfied),
      ids(meta, (source) => source.proofs.routingMatched.satisfied)
    ),
    gate("sheets_destination_saved", input.sheetsSelected, input.destinationSaved, input.evidence.destinationId ? [input.evidence.destinationId] : []),
    gate("sheets_control_verified", input.sheetsSelected, input.controlVerified, input.evidence.destinationId ? [input.evidence.destinationId] : []),
    gate("sheets_tab_explicitly_bound", input.sheetsSelected, input.tabBound, input.evidence.campaignContractId ? [input.evidence.campaignContractId] : []),
    gate("sheets_header_dispatch_ready", input.sheetsSelected, input.headerReady, input.evidence.campaignContractId ? [input.evidence.campaignContractId] : []),
    gate("sheets_custom_map_published", input.customMapRequired, input.customMapPublished, []),
    gate(
      "sheets_permission_probe",
      input.sheetsSelected,
      input.writeReadiness === COMPANY_SHEETS_WRITE_READINESS_VERIFIED && input.headerReady,
      input.writeReadiness === COMPANY_SHEETS_WRITE_READINESS_VERIFIED && input.evidence.destinationId
        ? [input.evidence.destinationId]
        : []
    ),
    gate("sheets_writer_receipt", false, Boolean(input.writerJobId), input.writerJobId ? [input.writerJobId] : [], "evidence"),
    gate("sheets_no_uncertain_job", input.sheetsSelected, input.uncertainJobs === 0, []),
    gate("ghl_mode_explicit", input.ghlSelected, input.mode !== "unset", []),
    gate("ghl_location_configured", input.ghlSelected && input.mode === "location_api", input.locationIdPresent, []),
    gate(
      "ghl_webhook_stored_disabled",
      input.webhookTargets.length > 0,
      webhookStoredDisabled && !input.inboundWebhookArmed,
      input.evidence.webhookIds
    ),
    gate("ghl_note_contract_ready", input.notesEnabled, input.noteContractReady, []),
    gate("zapier_not_disabled", true, true, []),
    gate("aged_not_activated_by_onboarding", true, true, []),
  ];
}

function isProfileGhlMode(
  value: string | null | undefined
): "unset" | "location_api" | "inbound_webhook" | "external_zapier" | null {
  if (value === "unset" || value === "location_api" || value === "inbound_webhook" || value === "external_zapier") {
    return value;
  }
  return null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((cell) => typeof cell === "string")) return null;
  return value;
}
