/**
 * Read-only source proof for one client.
 * linked, observed, routing_matched, and delivery stay independent.
 * This module does not insert events, rerun routing, or call a provider.
 */

import type { CampaignRoutingMatchType, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { isExactRoutingRuleMatchType } from "../routing-matcher.service.js";
import {
  ROUTING_AUTHORITY_CAMPAIGN_RULE,
  ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
} from "../routing-source-association.service.js";
import {
  captureNextAction,
  type FacebookFormAssociationOutcome,
} from "../source-intake/facebook-form-association.js";
import { COMPANY_SHEETS_INTERNAL_TEST_CLIENT } from "../company-sheets-dispatch/company-sheets-campaign-pilot.js";

const EVENT_SCAN_CAP = 2000;
const LOOSE_MATCH_TYPES = new Set(["utm_campaign", "keyword_fallback"]);
const FACEBOOK_OUTCOMES = new Set<FacebookFormAssociationOutcome>([
  "associated",
  "unassociated",
  "ambiguous",
  "missing_form_identity",
  "invalid_form_identity",
  "not_evaluated",
  "association_disabled",
]);

export type OnboardingSourceKind = "leadcapture" | "meta_lead_ads" | "zapier_facebook";

export type OnboardingSourceProof = {
  sourceKind: OnboardingSourceKind;
  sourceFunnelId: string;
  associationStatus: string;
  identity: {
    provider: string;
    providerFunnelId: string | null;
    parentUrlKey: string | null;
    pageSlug: string | null;
  };
  /** Stored capture next step. Capture-only text is not rewritten into a delivery instruction. */
  nextAction: string | null;
  thisRequestAttempted: boolean | null;
  proofs: {
    linked: { satisfied: boolean; at: string | null };
    observed: {
      satisfied: boolean;
      at: string | null;
      sourceLeadEventId: string | null;
      intakeStage: string | null;
      captureOnly: boolean;
    };
    routingMatched: {
      satisfied: boolean;
      authority: string | null;
      routingDryRunDecisionId: string | null;
      matchedRuleId: string | null;
      looseRuleIgnored: string | null;
    };
    delivery: {
      satisfied: boolean;
      sheetsJobId: string | null;
      ghlReceiptId: string | null;
    };
  };
};

export type ProofFunnel = {
  id: string;
  provider: string;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  pageSlug: string | null;
  associationStatus: string;
  originClientAccountId: string | null;
  suggestedClientAccountId: string | null;
  firstSeenAt: Date | null;
  updatedAt: Date;
};

export type ProofEvent = {
  id: string;
  sourceProvider: string;
  sourceSystem: string;
  status: string;
  sourceLeadId: string | null;
  sourceRouteKey: string | null;
  clientAccountIdResolved: string | null;
  routingRuleIdResolved: string | null;
  routingDryRunDecisionId: string | null;
  receivedAt: Date;
  rawPayloadJson: unknown;
  normalizedPayloadJson: unknown;
  routingResultJson: unknown;
  enrichmentMetadataJson: unknown;
  deliveryResultJson: unknown;
};

export type ProofJob = {
  id: string;
  kind: string;
  status: string;
  sourceLeadEventId: string | null;
  clientAccountId: string;
};

export type ProofIntent = {
  sourceLeadEventId: string | null;
  kind: string;
  createdAt: Date;
  clientAccountId: string;
};

export type ProofGhlReceipt = {
  id: string;
  mode: string;
  status: string;
  startedAt: Date;
  routingDryRunDecisionId: string | null;
  destinationClientAccountId: string;
};

export type LoadedSourceProof = {
  clientAccountId: string;
  cutoff: Date | null;
  funnels: ProofFunnel[];
  events: ProofEvent[];
  jobs: ProofJob[];
  intents: ProofIntent[];
  ghlReceipts: ProofGhlReceipt[];
  evidenceTruncated: boolean;
};

export function findProductionSheetsDelivery(input: {
  jobs: ProofJob[];
  intents: ProofIntent[];
  cutoff: Date | null;
  clientAccountId: string;
  sourceLeadEventId?: string | null;
}): string | null {
  if (!input.cutoff) return null;
  const jobs = input.jobs.filter(
    (job) =>
      job.clientAccountId === input.clientAccountId &&
      job.kind === "lead" &&
      job.status === "succeeded" &&
      Boolean(job.sourceLeadEventId) &&
      (input.sourceLeadEventId == null || job.sourceLeadEventId === input.sourceLeadEventId)
  );
  for (const job of jobs) {
    const intent = input.intents.find(
      (row) =>
        row.clientAccountId === input.clientAccountId &&
        row.kind === "campaign_lead" &&
        row.sourceLeadEventId === job.sourceLeadEventId &&
        row.createdAt.getTime() >= input.cutoff!.getTime()
    );
    if (intent && job.sourceLeadEventId !== "synthetic-campaign-test") return job.id;
  }
  return null;
}

export function findProductionGhlReceipt(input: {
  receipts: ProofGhlReceipt[];
  cutoff: Date | null;
  clientAccountId: string;
  routingDryRunDecisionId: string | null;
}): string | null {
  if (!input.cutoff || !input.routingDryRunDecisionId) return null;
  const receipt = input.receipts.find(
    (row) =>
      row.destinationClientAccountId === input.clientAccountId &&
      row.routingDryRunDecisionId === input.routingDryRunDecisionId &&
      row.status === "succeeded" &&
      row.mode === "location_api" &&
      row.startedAt.getTime() >= input.cutoff!.getTime()
  );
  return receipt?.id ?? null;
}

export function assembleClientSourceProof(input: LoadedSourceProof): {
  sources: OnboardingSourceProof[];
  evidenceTruncated: boolean;
} {
  const clientAccountId = input.clientAccountId;
  const funnels = input.funnels.filter(
    (funnel) =>
      funnel.originClientAccountId === clientAccountId ||
      funnel.suggestedClientAccountId === clientAccountId
  );
  const sources: OnboardingSourceProof[] = [];
  for (const funnel of funnels) {
    sources.push(...proofsForFunnel(funnel, input));
  }
  return { sources, evidenceTruncated: input.evidenceTruncated };
}

export async function readClientSourceProof(
  clientAccountId: string,
  db: PrismaClient = prisma
): Promise<{ sources: OnboardingSourceProof[]; evidenceTruncated: boolean }> {
  const [funnels, events, jobs, intents, destination] = await Promise.all([
    db.sourceFunnel.findMany({
      where: {
        OR: [{ originClientAccountId: clientAccountId }, { suggestedClientAccountId: clientAccountId }],
      },
    }),
    db.sourceLeadEvent.findMany({
      where: {
        OR: [
          { clientAccountIdResolved: clientAccountId },
          { clientAccountIdResolved: null, sourceProvider: { in: ["leadcapture_io", "facebook"] } },
        ],
      },
      orderBy: { receivedAt: "desc" },
      take: EVENT_SCAN_CAP,
    }),
    db.companySheetsDeliveryJob.findMany({
      where: { clientAccountId },
      orderBy: { createdAt: "desc" },
      take: EVENT_SCAN_CAP,
    }),
    db.companySheetsDispatchIntent.findMany({
      where: { clientAccountId, kind: "campaign_lead" },
      orderBy: { createdAt: "desc" },
      take: EVENT_SCAN_CAP,
    }),
    db.companySheetsDestination.findUnique({ where: { clientAccountId } }),
  ]);
  const decisionIds = [
    ...new Set(
      events
        .map((event) => event.routingDryRunDecisionId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const ghlReceipts =
    decisionIds.length === 0
      ? []
      : await db.ghlLiveDeliveryRun.findMany({
          where: {
            destinationClientAccountId: clientAccountId,
            leadDeliveryPlan: { routingDryRunDecisionId: { in: decisionIds } },
          },
          select: {
            id: true,
            mode: true,
            status: true,
            startedAt: true,
            destinationClientAccountId: true,
            leadDeliveryPlan: { select: { routingDryRunDecisionId: true } },
          },
        });
  return assembleClientSourceProof({
    clientAccountId,
    cutoff: destination?.campaignDispatchNotBefore ?? null,
    evidenceTruncated: events.length >= EVENT_SCAN_CAP || jobs.length >= EVENT_SCAN_CAP,
    funnels: funnels.map((funnel) => ({
      id: funnel.id,
      provider: funnel.provider,
      providerFunnelId: funnel.providerFunnelId,
      parentUrlKey: funnel.parentUrlKey,
      pageSlug: funnel.pageSlug,
      associationStatus: funnel.associationStatus,
      originClientAccountId: funnel.originClientAccountId,
      suggestedClientAccountId: funnel.suggestedClientAccountId,
      firstSeenAt: funnel.firstSeenAt,
      updatedAt: funnel.updatedAt,
    })),
    events: events.map((event) => ({
      id: event.id,
      sourceProvider: event.sourceProvider,
      sourceSystem: event.sourceSystem,
      status: event.status,
      sourceLeadId: event.sourceLeadId,
      sourceRouteKey: event.sourceRouteKey,
      clientAccountIdResolved: event.clientAccountIdResolved,
      routingRuleIdResolved: event.routingRuleIdResolved,
      routingDryRunDecisionId: event.routingDryRunDecisionId,
      receivedAt: event.receivedAt,
      rawPayloadJson: event.rawPayloadJson,
      normalizedPayloadJson: event.normalizedPayloadJson,
      routingResultJson: event.routingResultJson,
      enrichmentMetadataJson: event.enrichmentMetadataJson,
      deliveryResultJson: event.deliveryResultJson,
    })),
    jobs: jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      status: job.status,
      sourceLeadEventId: job.sourceLeadEventId,
      clientAccountId: job.clientAccountId,
    })),
    intents: intents.map((intent) => ({
      sourceLeadEventId: intent.sourceLeadEventId,
      kind: intent.kind,
      createdAt: intent.createdAt,
      clientAccountId: intent.clientAccountId,
    })),
    ghlReceipts: ghlReceipts.map((receipt) => ({
      id: receipt.id,
      mode: receipt.mode,
      status: receipt.status,
      startedAt: receipt.startedAt,
      destinationClientAccountId: receipt.destinationClientAccountId,
      routingDryRunDecisionId: receipt.leadDeliveryPlan?.routingDryRunDecisionId ?? null,
    })),
  });
}

function proofsForFunnel(funnel: ProofFunnel, input: LoadedSourceProof): OnboardingSourceProof[] {
  const related = input.events.filter((event) => concernsFunnel(event, funnel, input.clientAccountId));
  if (funnel.provider === "facebook") {
    const zapier = related.filter((event) => eventKind(event) === "zapier_facebook");
    const meta = related.filter((event) => eventKind(event) !== "zapier_facebook");
    const rows: OnboardingSourceProof[] = [];
    if (meta.length > 0 || zapier.length === 0) {
      rows.push(buildProof(funnel, "meta_lead_ads", meta, input));
    }
    if (zapier.length > 0) rows.push(buildProof(funnel, "zapier_facebook", zapier, input));
    return rows;
  }
  return [buildProof(funnel, "leadcapture", related, input)];
}

function buildProof(
  funnel: ProofFunnel,
  sourceKind: OnboardingSourceKind,
  events: ProofEvent[],
  input: LoadedSourceProof
): OnboardingSourceProof {
  const natural = events
    .filter((event) => !isIgnoredPilot(event))
    .filter((event) => event.clientAccountIdResolved == null || event.clientAccountIdResolved === input.clientAccountId)
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const linked = funnel.associationStatus === "confirmed" && funnel.originClientAccountId === input.clientAccountId;
  const observedEvent =
    natural.find((event) => observationCounts(event, sourceKind)) ?? null;
  const observedAt = observedEvent?.receivedAt ?? (sourceKind === "leadcapture" ? funnel.firstSeenAt : null);
  const observed = Boolean(observedEvent) || (sourceKind === "leadcapture" && funnel.firstSeenAt != null);
  const captureEvent = natural.find((event) => record(event.enrichmentMetadataJson)?.captureOnly === true) ?? observedEvent;
  const routing = routingProof(natural, funnel, input.clientAccountId);
  const loose = natural.some((event) => isLooseRule(event)) ? "loose_rule_not_source_proof" : null;
  let sheetsJobId: string | null = null;
  let ghlReceiptId: string | null = null;
  for (const event of natural) {
    if (!sheetsJobId) {
      sheetsJobId = findProductionSheetsDelivery({
        jobs: input.jobs,
        intents: input.intents,
        cutoff: input.cutoff,
        clientAccountId: input.clientAccountId,
        sourceLeadEventId: event.id,
      });
    }
    if (!ghlReceiptId) {
      ghlReceiptId = findProductionGhlReceipt({
        receipts: input.ghlReceipts,
        cutoff: input.cutoff,
        clientAccountId: input.clientAccountId,
        routingDryRunDecisionId: event.routingDryRunDecisionId,
      });
    }
  }
  const enrichment = record(captureEvent?.enrichmentMetadataJson);
  const delivery = record(enrichment?.delivery);
  return {
    sourceKind,
    sourceFunnelId: funnel.id,
    associationStatus: funnel.associationStatus,
    identity: {
      provider: funnel.provider,
      providerFunnelId: funnel.providerFunnelId,
      parentUrlKey: funnel.parentUrlKey,
      pageSlug: funnel.pageSlug,
    },
    nextAction: readNextAction(captureEvent ?? null),
    thisRequestAttempted: typeof delivery?.thisRequestAttempted === "boolean" ? delivery.thisRequestAttempted : null,
    proofs: {
      linked: { satisfied: linked, at: linked ? funnel.updatedAt.toISOString() : null },
      observed: {
        satisfied: observed,
        at: observed && observedAt ? observedAt.toISOString() : null,
        sourceLeadEventId: observedEvent?.id ?? null,
        intakeStage: typeof enrichment?.intakeStage === "string" ? enrichment.intakeStage : null,
        captureOnly: enrichment?.captureOnly === true,
      },
      routingMatched: {
        satisfied: routing.satisfied,
        authority: routing.authority,
        routingDryRunDecisionId: routing.routingDryRunDecisionId,
        matchedRuleId: routing.matchedRuleId,
        looseRuleIgnored: loose,
      },
      delivery: {
        satisfied: Boolean(sheetsJobId || ghlReceiptId),
        sheetsJobId,
        ghlReceiptId,
      },
    },
  };
}

function routingProof(
  events: ProofEvent[],
  funnel: ProofFunnel,
  clientAccountId: string
): {
  satisfied: boolean;
  authority: string | null;
  routingDryRunDecisionId: string | null;
  matchedRuleId: string | null;
} {
  for (const event of events) {
    if (event.status !== "routing_matched") continue;
    if (event.clientAccountIdResolved !== clientAccountId) continue;
    if (isLooseRule(event)) continue;
    const facts = routingFacts(event);
    if (facts.authority === ROUTING_AUTHORITY_SOURCE_ASSOCIATION && associationFunnelId(event) === funnel.id) {
      return {
        satisfied: true,
        authority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
        routingDryRunDecisionId: facts.decisionId,
        matchedRuleId: null,
      };
    }
    if (facts.authority === ROUTING_AUTHORITY_CAMPAIGN_RULE && facts.exact && concernsFunnel(event, funnel, clientAccountId)) {
      return {
        satisfied: true,
        authority: ROUTING_AUTHORITY_CAMPAIGN_RULE,
        routingDryRunDecisionId: facts.decisionId,
        matchedRuleId: facts.matchedRuleId,
      };
    }
    if (
      facts.authority == null &&
      facts.exact &&
      concernsFunnel(event, funnel, clientAccountId)
    ) {
      return {
        satisfied: true,
        authority: ROUTING_AUTHORITY_CAMPAIGN_RULE,
        routingDryRunDecisionId: facts.decisionId,
        matchedRuleId: facts.matchedRuleId,
      };
    }
  }
  return { satisfied: false, authority: null, routingDryRunDecisionId: null, matchedRuleId: null };
}

function concernsFunnel(event: ProofEvent, funnel: ProofFunnel, clientAccountId: string): boolean {
  if (event.clientAccountIdResolved && event.clientAccountIdResolved !== clientAccountId) return false;
  if (identityMatches(event, funnel)) return true;
  if (!isLooseRule(event) || funnel.provider !== "leadcapture_io") return false;
  const associationFunnelId = routingFacts(event).associationFunnelId;
  if (associationFunnelId && associationFunnelId !== funnel.id) return false;
  return event.clientAccountIdResolved === clientAccountId;
}

function identityMatches(event: ProofEvent, funnel: ProofFunnel): boolean {
  const association = routingFacts(event);
  if (association.associationFunnelId === funnel.id) return true;
  if (funnel.providerFunnelId && association.providerFunnelId === funnel.providerFunnelId) return true;
  if (
    funnel.provider === "leadcapture_io" &&
    funnel.parentUrlKey &&
    association.parentUrlKey === funnel.parentUrlKey &&
    event.sourceProvider === "leadcapture_io"
  ) {
    return true;
  }
  const enrichment = record(event.enrichmentMetadataJson);
  const enrich = record(enrichment?.association);
  if (enrich?.sourceFunnelId === funnel.id) return true;
  if (funnel.provider === "facebook" && funnel.providerFunnelId && enrich?.pageId && enrich?.formId) {
    if (funnel.providerFunnelId === `fbpage:${String(enrich.pageId)}:fbform:${String(enrich.formId)}`) return true;
  }
  const normalized = record(event.normalizedPayloadJson);
  const normalizedAssociation = record(normalized?.association);
  if (normalizedAssociation?.source_funnel_id === funnel.id) return true;
  const source = record(normalized?.source);
  if (funnel.provider === "facebook" && funnel.providerFunnelId && source?.page_id && source?.form_id) {
    return funnel.providerFunnelId === `fbpage:${String(source.page_id)}:fbform:${String(source.form_id)}`;
  }
  return false;
}

function observationCounts(event: ProofEvent, sourceKind: OnboardingSourceKind): boolean {
  if (sourceKind === "leadcapture") return identityEvent(event);
  const enrichment = record(event.enrichmentMetadataJson);
  if (enrichment?.captureOnly === true || enrichment?.captureSettled === true) return true;
  return event.status === "routing_matched";
}

function identityEvent(event: ProofEvent): boolean {
  return !isIgnoredPilot(event);
}

function isIgnoredPilot(event: ProofEvent): boolean {
  if (event.id === "synthetic-campaign-test" || event.sourceLeadId === "synthetic-campaign-test") return true;
  const enrichment = record(event.enrichmentMetadataJson);
  if (enrichment?.synthetic === true || enrichment?.internalPilot === true) return true;
  if (enrichment?.intakeStage === "column_mapping_preview") return true;
  const authority = routingFacts(event).authority;
  return (
    authority === "operator_selected_destination" &&
    event.clientAccountIdResolved === COMPANY_SHEETS_INTERNAL_TEST_CLIENT
  );
}

function isLooseRule(event: ProofEvent): boolean {
  const facts = routingFacts(event);
  if (facts.authority === ROUTING_AUTHORITY_SOURCE_ASSOCIATION) return false;
  if (facts.matchType && LOOSE_MATCH_TYPES.has(facts.matchType)) return true;
  return facts.authority === ROUTING_AUTHORITY_CAMPAIGN_RULE && Boolean(facts.matchType) && !facts.exact;
}

function routingFacts(event: ProofEvent): {
  authority: string | null;
  matchType: string | null;
  exact: boolean;
  associationFunnelId: string | null;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  decisionId: string | null;
  matchedRuleId: string | null;
} {
  const routing = record(event.routingResultJson);
  const association = record(routing?.sourceAssociation);
  const matchType = text(routing?.matchType);
  const exact = isExactRoutingRuleMatchType(asRoutingMatchType(matchType));
  return {
    authority: text(routing?.routingAuthority),
    matchType,
    exact,
    associationFunnelId: text(association?.sourceFunnelId),
    providerFunnelId: text(association?.providerFunnelId),
    parentUrlKey: text(association?.parentUrlKey),
    decisionId: text(routing?.routingDryRunDecisionId) ?? event.routingDryRunDecisionId,
    matchedRuleId: text(routing?.matchedRuleId) ?? event.routingRuleIdResolved,
  };
}

function eventKind(event: ProofEvent): OnboardingSourceKind {
  const enrichment = record(event.enrichmentMetadataJson);
  if (enrichment?.intakeMethod === "zapier_facebook") return "zapier_facebook";
  if (event.sourceProvider === "leadcapture_io") return "leadcapture";
  return "meta_lead_ads";
}

function readNextAction(event: ProofEvent | null): string | null {
  if (!event) return null;
  const enrichment = record(event.enrichmentMetadataJson);
  const stored =
    text(enrichment?.nextAction) ??
    text(record(event.rawPayloadJson)?.nextAction) ??
    text(record(event.normalizedPayloadJson)?.nextAction) ??
    text(record(event.deliveryResultJson)?.nextAction);
  if (stored) return stored;
  if (enrichment?.captureOnly !== true) return null;
  const outcome = text(record(enrichment.association)?.outcome);
  if (outcome && FACEBOOK_OUTCOMES.has(outcome as FacebookFormAssociationOutcome)) {
    return captureNextAction(outcome as FacebookFormAssociationOutcome);
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function associationFunnelId(event: ProofEvent): string | null {
  return (
    routingFacts(event).associationFunnelId ??
    text(record(record(event.enrichmentMetadataJson)?.association)?.sourceFunnelId)
  );
}

function asRoutingMatchType(value: string | null): CampaignRoutingMatchType | undefined {
  if (
    value === "campaign_id" ||
    value === "adset_id" ||
    value === "ad_id" ||
    value === "form_id_utm_campaign" ||
    value === "utm_campaign" ||
    value === "keyword_fallback"
  ) {
    return value;
  }
  return undefined;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}
