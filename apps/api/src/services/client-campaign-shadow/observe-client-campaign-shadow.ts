/**
 * Persist one frozen campaign shadow decision for a source lead event.
 *
 * Called after live routing has committed. A failure here is logged by the
 * caller and does not roll back the lead. The flag must be the exact string
 * "true". An existing row for this event and decision version is left as it
 * was, including after a duplicate webhook.
 */

import { Prisma, type PrismaClient, type SourceLeadProvider } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { isClientCampaignShadowResolutionEnabled } from "../../lib/client-campaign-shadow-env.js";
import { readIncomingNicheEvidence } from "./niche-classification.js";
import { leadTypeForShadow } from "./lead-type-for-shadow.js";
import {
  CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION,
  resolveClientCampaignShadow,
  type ClientCampaignShadowDecision,
  type ShadowBindingCandidate,
  type ShadowCampaignConfig,
} from "./resolve-client-campaign-shadow.js";
import { extractShadowSourceEvidence } from "./source-evidence.js";

type ShadowDb = PrismaClient | Prisma.TransactionClient;

const SOURCE_PROVIDERS = new Set<string>([
  "leadcapture_io",
  "facebook",
  "goat_leads",
  "manual_import",
  "google_sheets",
]);

function asProvider(value: string | null): SourceLeadProvider | null {
  if (!value || !SOURCE_PROVIDERS.has(value)) return null;
  return value as SourceLeadProvider;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function exactRawPresent(raw: unknown, normalized: unknown): boolean {
  const records = [asRecord(raw), asRecord(normalized), asRecord(asRecord(normalized)?.attribution), asRecord(asRecord(normalized)?.routing)];
  const keys = [
    "funnel_id",
    "sa360_funnel_id",
    "parent_url",
    "parent_url_key",
    "form_id",
    "sa360_form_id",
    "campaign_id",
    "sa360_campaign_id",
    "adset_id",
    "ad_id",
  ];
  return records.some((record) => record && keys.some((key) => text(record[key])));
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function shadowDecisionCreateData(
  sourceLeadEventId: string,
  decision: ClientCampaignShadowDecision,
  evaluatedAt: Date
): Prisma.ClientCampaignShadowDecisionCreateInput {
  return {
    sourceLeadEvent: { connect: { id: sourceLeadEventId } },
    decisionVersion: decision.version,
    status: decision.status,
    clientAccountId: decision.clientAccountId,
    clientCampaignId: decision.clientCampaignId,
    campaignRevision: decision.campaignRevision,
    campaignSlug: decision.campaignSlug,
    campaignDisplayName: decision.campaignDisplayName,
    campaignStatus: decision.campaignStatus,
    configuredNicheKey: decision.configuredNicheKey,
    configuredProductType: decision.configuredProductType,
    winningRoutingAuthority: decision.winningRoutingAuthority,
    matchType: decision.matchType,
    provider: decision.provider,
    matchedBindingIds: jsonValue(decision.matchedBindingIds),
    reviewCandidateCampaignIds: jsonValue(decision.reviewCandidateCampaignIds),
    reasonCodes: jsonValue(decision.reasonCodes),
    sourceEvidenceJson: jsonValue(decision.sourceEvidence),
    incomingNicheJson: jsonValue(decision.incomingNiche),
    nicheClassificationStatus: decision.nicheClassificationStatus,
    leadTypeDecisionJson: jsonValue(decision.leadTypeDecision ?? { absent: true }),
    proposedTagsJson: jsonValue(decision.proposedTags),
    destinationSelectionJson: jsonValue(decision.destinationSelection ?? { absent: true }),
    evaluatedAt,
  };
}

async function loadBindings(
  db: ShadowDb,
  evidence: ReturnType<typeof extractShadowSourceEvidence>
): Promise<{ bindings: ShadowBindingCandidate[]; campaigns: ShadowCampaignConfig[] }> {
  if (evidence.identifiers.length === 0 || !evidence.provider) return { bindings: [], campaigns: [] };
  const identityMatches = evidence.identifiers.flatMap((identity) => {
    const provider = asProvider(identity.provider);
    if (!provider) return [];
    return [{ provider, kind: identity.kind, normalizedValue: identity.normalizedValue }];
  });
  if (identityMatches.length === 0) return { bindings: [], campaigns: [] };
  const rows = await db.clientCampaignSourceIdentity.findMany({
    where: {
      active: true,
      bindingStatus: "approved",
      OR: identityMatches,
    },
    include: {
      binding: { select: { id: true, status: true, sourceFunnelId: true, clientCampaignId: true } },
      clientCampaign: {
        select: {
          id: true,
          clientAccountId: true,
          slug: true,
          displayName: true,
          nicheKey: true,
          productType: true,
          status: true,
          revision: true,
          destination: {
            select: {
              workflowIdGhl: true,
              workflowTriggerMode: true,
              ghlLocationId: true,
              spreadsheetId: true,
              worksheetId: true,
              worksheetTitle: true,
            },
          },
        },
      },
    },
  });
  const funnelIds = [
    ...new Set(
      rows.flatMap((row) => (row.binding.sourceFunnelId ? [row.binding.sourceFunnelId] : []))
    ),
  ];
  const funnels = funnelIds.length
    ? await db.sourceFunnel.findMany({
        where: { id: { in: funnelIds } },
        select: { id: true, originClientAccountId: true },
      })
    : [];
  const origins = new Map(funnels.map((funnel) => [funnel.id, funnel.originClientAccountId]));
  const byBinding = new Map<string, ShadowBindingCandidate>();
  const campaigns = new Map<string, ShadowCampaignConfig>();
  for (const row of rows) {
    if (row.binding.status !== "approved") continue;
    const current = byBinding.get(row.bindingId) ?? {
      bindingId: row.binding.id,
      clientCampaignId: row.clientCampaignId,
      clientAccountId: row.clientAccountId,
      sourceFunnelId: row.binding.sourceFunnelId,
      sourceFunnelOriginClientAccountId: row.binding.sourceFunnelId
        ? (origins.get(row.binding.sourceFunnelId) ?? null)
        : null,
      identities: [],
    };
    current.identities.push({
      provider: row.provider,
      kind: row.kind,
      normalizedValue: row.normalizedValue,
    });
    byBinding.set(row.bindingId, current);
    const campaign = row.clientCampaign;
    campaigns.set(campaign.id, {
      id: campaign.id,
      clientAccountId: campaign.clientAccountId,
      slug: campaign.slug,
      displayName: campaign.displayName,
      nicheKey: campaign.nicheKey,
      productType: campaign.productType,
      status: campaign.status,
      revision: campaign.revision,
      destination: campaign.destination
        ? {
            workflowIdGhl: campaign.destination.workflowIdGhl,
            workflowTriggerMode: campaign.destination.workflowTriggerMode,
            ghlLocationId: campaign.destination.ghlLocationId,
            spreadsheetId: campaign.destination.spreadsheetId,
            worksheetId: campaign.destination.worksheetId,
            worksheetTitle: campaign.destination.worksheetTitle,
          }
        : null,
    });
  }
  return { bindings: [...byBinding.values()], campaigns: [...campaigns.values()] };
}

export async function observeClientCampaignShadow(
  sourceLeadEventId: string,
  env: NodeJS.ProcessEnv = process.env,
  db: ShadowDb = prisma
): Promise<{ written: boolean; skipped: "disabled" | "frozen" | "event_not_found" | null }> {
  if (!isClientCampaignShadowResolutionEnabled(env)) return { written: false, skipped: "disabled" };
  const version = CLIENT_CAMPAIGN_SHADOW_DECISION_VERSION;
  const existing = await db.clientCampaignShadowDecision.findUnique({
    where: { sourceLeadEventId_decisionVersion: { sourceLeadEventId, decisionVersion: version } },
    select: { id: true },
  });
  if (existing) return { written: false, skipped: "frozen" };

  const event = await db.sourceLeadEvent.findUnique({ where: { id: sourceLeadEventId } });
  if (!event) return { written: false, skipped: "event_not_found" };

  const routing = asRecord(event.routingResultJson);
  const association = asRecord(routing?.sourceAssociation);
  const evidence = extractShadowSourceEvidence({
    provider: event.sourceProvider,
    rawPayload: event.rawPayloadJson,
    normalizedPayload: event.normalizedPayloadJson,
    routingResult: event.routingResultJson,
    matchType: text(routing?.matchType),
  });
  const confirmedSourceFunnelId = text(association?.sourceFunnelId);
  const associationFunnel = confirmedSourceFunnelId
    ? await db.sourceFunnel.findUnique({
        where: { id: confirmedSourceFunnelId },
        select: { id: true, leadTypeKey: true, originClientAccountId: true },
      })
    : null;
  const providerFunnelId = evidence.identifiers.find((item) => item.kind === "provider_funnel_id")?.normalizedValue;
  const observedProvider = asProvider(evidence.provider);
  const observedFunnel =
    observedProvider && providerFunnelId
      ? await db.sourceFunnel.findUnique({
          where: {
            provider_providerFunnelId: {
              provider: observedProvider,
              providerFunnelId,
            },
          },
          select: { id: true, leadTypeKey: true },
        })
      : null;
  const loaded = await loadBindings(db, evidence);
  const decision = resolveClientCampaignShadow({
    routing: {
      clientAccountId: event.clientAccountIdResolved,
      routingAuthority: text(routing?.routingAuthority),
      matchType: text(routing?.matchType),
      matched: routing?.matched === true,
      matchedRuleId: text(routing?.matchedRuleId),
      confirmedSourceFunnelId,
      confirmedSourceOriginClientAccountId: associationFunnel?.originClientAccountId ?? null,
    },
    provider: evidence.provider,
    evidence: evidence.identifiers,
    looseEvidenceIgnored: evidence.looseEvidenceIgnored,
    hadExactValuesWithoutProvider: !evidence.provider && exactRawPresent(event.rawPayloadJson, event.normalizedPayloadJson),
    bindings: loaded.bindings,
    campaigns: loaded.campaigns,
    incomingNiche: readIncomingNicheEvidence({
      rawPayload: event.rawPayloadJson,
      normalizedPayload: event.normalizedPayloadJson,
      routeKey: event.sourceRouteKey,
    }),
    leadTypeDecision: leadTypeForShadow({
      routingResult: event.routingResultJson,
      rawPayload: event.rawPayloadJson,
      normalizedPayload: event.normalizedPayloadJson,
      routingAuthority: text(routing?.routingAuthority),
      matched: routing?.matched === true,
      matchedRuleId: text(routing?.matchedRuleId),
      matchType: text(routing?.matchType),
      sourceAssociation: associationFunnel
        ? { id: associationFunnel.id, leadTypeKey: associationFunnel.leadTypeKey }
        : null,
      observedSource: observedFunnel
        ? { id: observedFunnel.id, leadTypeKey: observedFunnel.leadTypeKey }
        : null,
    }),
  });

  try {
    await db.clientCampaignShadowDecision.create({
      data: shadowDecisionCreateData(sourceLeadEventId, decision, new Date()),
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { written: false, skipped: "frozen" };
    }
    throw err;
  }
  return { written: true, skipped: null };
}
