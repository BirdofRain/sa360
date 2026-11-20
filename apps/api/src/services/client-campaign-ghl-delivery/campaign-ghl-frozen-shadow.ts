/**
 * Read a frozen campaign shadow row into the planner snapshot.
 * Spreadsheet fields are dropped. A stored execution flag other than false
 * fails closed. Contact tags are not read here.
 */

import { createHash } from "node:crypto";

import type { ClientCampaignShadowDecision as ShadowRow } from "@prisma/client";

import { CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION } from "../client-campaign-shadow/resolve-client-campaign-shadow.js";
import type { CampaignDeliverySnapshot } from "./plan-campaign-ghl-delivery.js";

export type FrozenCampaignScope = {
  shadowDecisionId: string;
  sourceLeadEventId: string;
  decisionVersion: number;
  clientAccountId: string;
  clientCampaignId: string;
  campaignRevision: number;
  campaignSlug: string;
  configuredNicheKey: string;
  configuredProductType: string;
  ghlLocationId: string;
  workflowIdGhl: string;
  workflowTriggerMode: string;
};

export function campaignGhlConfigurationHash(scope: FrozenCampaignScope): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        shadowDecisionId: scope.shadowDecisionId,
        sourceLeadEventId: scope.sourceLeadEventId,
        decisionVersion: scope.decisionVersion,
        clientAccountId: scope.clientAccountId,
        clientCampaignId: scope.clientCampaignId,
        campaignRevision: scope.campaignRevision,
        campaignSlug: scope.campaignSlug,
        configuredNicheKey: scope.configuredNicheKey,
        configuredProductType: scope.configuredProductType,
        ghlLocationId: scope.ghlLocationId,
        workflowIdGhl: scope.workflowIdGhl,
        workflowTriggerMode: scope.workflowTriggerMode,
      })
    )
    .digest("hex");
}

export function snapshotFromShadowRow(row: ShadowRow): CampaignDeliverySnapshot {
  const tags = asRecord(row.proposedTagsJson);
  const destination = destinationFrom(row.destinationSelectionJson);
  return {
    decisionVersion: row.decisionVersion,
    status: row.status,
    clientAccountId: row.clientAccountId,
    clientCampaignId: row.clientCampaignId,
    campaignRevision: row.campaignRevision,
    campaignSlug: row.campaignSlug,
    campaignDisplayName: row.campaignDisplayName,
    campaignStatus: row.campaignStatus,
    configuredNicheKey: row.configuredNicheKey,
    configuredProductType: row.configuredProductType,
    nicheClassificationStatus: row.nicheClassificationStatus,
    reasonCodes: stringList(row.reasonCodes),
    reviewCandidateCampaignIds: stringList(row.reviewCandidateCampaignIds),
    executionAuthorized: tags?.executionAuthorized !== false,
    destination,
  };
}

export function frozenScopeFromShadow(row: ShadowRow, sourceLeadEventId: string): FrozenCampaignScope | null {
  if (row.decisionVersion !== CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION) return null;
  const destination = destinationFrom(row.destinationSelectionJson);
  const clientAccountId = row.clientAccountId?.trim() ?? "";
  const clientCampaignId = row.clientCampaignId?.trim() ?? "";
  const campaignSlug = row.campaignSlug?.trim() ?? "";
  const niche = row.configuredNicheKey?.trim() ?? "";
  const product = row.configuredProductType?.trim() ?? "";
  const locationId = destination?.ghlLocationId?.trim() ?? "";
  const workflowId = destination?.workflowIdGhl?.trim() ?? "";
  const triggerMode = destination?.workflowTriggerMode?.trim() ?? "";
  if (
    !clientAccountId ||
    !clientCampaignId ||
    !campaignSlug ||
    !niche ||
    !product ||
    !locationId ||
    !workflowId ||
    !triggerMode ||
    typeof row.campaignRevision !== "number"
  ) {
    return null;
  }
  return {
    shadowDecisionId: row.id,
    sourceLeadEventId,
    decisionVersion: row.decisionVersion,
    clientAccountId,
    clientCampaignId,
    campaignRevision: row.campaignRevision,
    campaignSlug,
    configuredNicheKey: niche,
    configuredProductType: product,
    ghlLocationId: locationId,
    workflowIdGhl: workflowId,
    workflowTriggerMode: triggerMode,
  };
}

function destinationFrom(value: unknown): CampaignDeliverySnapshot["destination"] {
  const record = asRecord(value);
  if (!record || record.absent === true) return null;
  return {
    workflowIdGhl: text(record.workflowIdGhl),
    workflowTriggerMode: text(record.workflowTriggerMode),
    ghlLocationId: text(record.ghlLocationId),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
