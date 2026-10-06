import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import type { LifecycleEventNameInternal } from "../schemas/lifecycle-event-names.js";
import { prisma } from "../lib/db.js";
import {
  extractRoutingAttributionFromPayload,
  type RoutingAttributionInput,
} from "../lib/routing-attribution-extract.js";
import { normalizeRoutingLeadIdentity } from "./routing-dry-run-lead-identity.js";
import { listActiveCampaignRoutingRules } from "../repositories/campaign-routing-rule.repository.js";
import { createRoutingDryRunDecision } from "../repositories/routing-dry-run-decision.repository.js";
import { saveLifecycleEvent } from "./event-service.js";
import {
  buildRoutingMatcherDebug,
  isExactRoutingRuleMatchType,
  matchCampaignRoutingRule,
  type RoutingMatcherDebug,
  type RoutingMatchResult,
} from "./routing-matcher.service.js";
import { evaluateAndPersistDuplicateRiskForRoutingDecision } from "./lead-identity/lead-identity-correlation.service.js";
import {
  resolveRoutingDestinationFromConfirmedSourceAssociation,
  ROUTING_AUTHORITY_CAMPAIGN_RULE,
  ROUTING_AUTHORITY_OPERATOR_DESTINATION,
  ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
  sourceAssociationMatchReason,
  type RoutingAuthority,
  type RoutingSourceAssociationOutcome,
} from "./routing-source-association.service.js";

export const ROUTING_DELIVERY_MODE_DRY_RUN = "dry_run" as const;

export type RoutingSourceAssociationEvidence = {
  sourceFunnelId: string;
  matchedBy: string;
  matchEvidence: string;
  parentUrlKey: string | null;
  providerFunnelId: string | null;
  pageSlug: string | null;
  routeKey: string | null;
  /** Loose (UTM/keyword) rule that the exact association outranked, if any. */
  overriddenLooseRuleId: string | null;
};

export type RoutingDryRunOutput = {
  matched: boolean;
  confidence: string;
  matchType?: string;
  matchedRuleId?: string;
  destinationClientAccountId?: string;
  destinationSubaccountIdGhl?: string;
  reason: string;
  deliveryMode: typeof ROUTING_DELIVERY_MODE_DRY_RUN;
  routingEventNameInternal: LifecycleEventNameInternal;
  decisionId: string;
  lifecycleEventsEmitted: LifecycleEventNameInternal[];
  routingAuthority: RoutingAuthority;
  sourceAssociation?: RoutingSourceAssociationEvidence;
  matcherDebug?: RoutingMatcherDebug;
};

export type RoutingDryRunServiceDeps = {
  prisma: PrismaClient;
  now: () => Date;
  saveLifecycleEvent: (payload: LifecycleEventSchema) => Promise<unknown>;
  resolveSourceAssociation: (
    payload: LifecycleEventSchema,
    db: PrismaClient
  ) => Promise<RoutingSourceAssociationOutcome>;
};

const defaultDeps: RoutingDryRunServiceDeps = {
  prisma,
  now: () => new Date(),
  saveLifecycleEvent,
  resolveSourceAssociation: resolveRoutingDestinationFromConfirmedSourceAssociation,
};

function routingEventForMatch(match: RoutingMatchResult): LifecycleEventNameInternal {
  if (!match.matched) return "routing_review_required";
  return "lead_matched";
}

function buildRoutingAttributionSnapshot(
  attribution: RoutingAttributionInput,
  payload: LifecycleEventSchema
): object {
  const leadIdentity = normalizeRoutingLeadIdentity(payload);
  if (!leadIdentity) {
    return attribution as unknown as object;
  }
  return {
    ...attribution,
    leadIdentity,
  } as object;
}

function buildRoutingLifecyclePayload(
  source: LifecycleEventSchema,
  eventNameInternal: LifecycleEventNameInternal,
  match: RoutingMatchResult,
  decisionId: string
): LifecycleEventSchema {
  const routingMeta = {
    dry_run: true,
    delivery_mode: ROUTING_DELIVERY_MODE_DRY_RUN,
    routing_decision_id: decisionId,
    matched: match.matched,
    confidence: match.confidence,
    matched_rule_id: match.matchedRuleId ?? null,
    destination_client_account_id: match.destinationClientAccountId ?? null,
    destination_subaccount_id_ghl: match.destinationSubaccountIdGhl ?? null,
    match_reason: match.reason,
    match_type: match.matchType ?? null,
  };

  return {
    ...source,
    event: {
      ...source.event,
      event_uuid: randomUUID(),
      event_name_internal: eventNameInternal,
      event_name_meta:
        eventNameInternal === "routing_review_required"
          ? "Routing review required"
          : eventNameInternal === "lead_matched"
            ? "Lead matched"
            : "Lead routed (dry run)",
      send_to_meta: false,
    },
    state: {
      ...source.state,
      routing_status: match.matched ? "matched_dry_run" : "review_required",
    },
    routing: {
      ...(source.routing ?? {}),
      ...routingMeta,
    },
  };
}

/** Events emitted after a dry-run (matched leads get match + routed audit events). */
export function lifecycleEventsToEmitForDryRun(
  match: RoutingMatchResult
): LifecycleEventNameInternal[] {
  if (!match.matched) return ["routing_review_required"];
  return ["lead_matched", "lead_routed_dry_run"];
}

/**
 * Evaluate routing for a lifecycle payload, persist decision, emit routing lifecycle events.
 * Does not create GHL contacts, call Zapier, or disable sheet backup.
 */
export async function runRoutingDryRun(
  sourcePayload: LifecycleEventSchema,
  deps: Partial<RoutingDryRunServiceDeps> = {},
  options: { debug?: boolean } = {}
): Promise<RoutingDryRunOutput> {
  const { prisma: db, now, saveLifecycleEvent: persistEvent, resolveSourceAssociation } = {
    ...defaultDeps,
    ...deps,
  };
  const input: RoutingAttributionInput =
    extractRoutingAttributionFromPayload(sourcePayload);
  const baseAttributionSnapshot = buildRoutingAttributionSnapshot(input, sourcePayload);
  const rules = await listActiveCampaignRoutingRules(input.masterClientAccountId, db);
  const ruleMatch = matchCampaignRoutingRule(rules, input, now());

  /**
   * Precedence: exact rule tiers → confirmed source association → loose
   * (UTM / keyword) rule tiers → review. An exact page/form identity is
   * stronger evidence than campaign text, so it outranks a loose rule match.
   */
  let match = ruleMatch;
  let routingAuthority: RoutingAuthority = ROUTING_AUTHORITY_CAMPAIGN_RULE;
  let sourceAssociation: RoutingSourceAssociationEvidence | undefined;
  let sourceAssociationUnresolvedReason: string | undefined;

  if (!isExactRoutingRuleMatchType(ruleMatch.matchType)) {
    const outcome = await resolveSourceAssociation(sourcePayload, db);
    if (outcome.resolved) {
      const { destination } = outcome;
      routingAuthority = ROUTING_AUTHORITY_SOURCE_ASSOCIATION;
      sourceAssociation = {
        sourceFunnelId: destination.match.sourceFunnelId,
        matchedBy: destination.match.matchedBy,
        matchEvidence: destination.match.matchEvidence,
        parentUrlKey: destination.match.parentUrlKey,
        providerFunnelId: destination.match.providerFunnelId,
        pageSlug: destination.match.pageSlug,
        routeKey: destination.match.routeKey,
        overriddenLooseRuleId: ruleMatch.matched ? (ruleMatch.matchedRuleId ?? null) : null,
      };
      match = {
        matched: true,
        confidence: "high",
        destinationClientAccountId: destination.destinationClientAccountId,
        destinationSubaccountIdGhl: destination.destinationSubaccountIdGhl,
        reason: sourceAssociationMatchReason(destination),
      };
    } else {
      sourceAssociationUnresolvedReason = outcome.reason;
    }
  }

  const attributionSnapshot = {
    ...(baseAttributionSnapshot as Record<string, unknown>),
    routingAuthority,
    ...(sourceAssociation ? { sourceAssociation } : {}),
    ...(sourceAssociationUnresolvedReason
      ? { sourceAssociationUnresolvedReason }
      : {}),
  } as object;

  const primaryEvent = routingEventForMatch(match);
  const decision = await createRoutingDryRunDecision(
    {
      masterClientAccountId: input.masterClientAccountId,
      sourceEventUuid: sourcePayload.event.event_uuid,
      sourceLeadUid: sourcePayload.contact.lead_uid,
      matched: match.matched,
      confidence: match.confidence,
      matchedRuleId: match.matchedRuleId ?? null,
      destinationClientAccountId: match.destinationClientAccountId ?? null,
      destinationSubaccountIdGhl: match.destinationSubaccountIdGhl ?? null,
      matchReason: match.reason,
      deliveryMode: ROUTING_DELIVERY_MODE_DRY_RUN,
      routingEventNameInternal: primaryEvent,
      attributionSnapshot,
    },
    db
  );

  try {
    await evaluateAndPersistDuplicateRiskForRoutingDecision({
      routingDryRunDecisionId: decision.id,
      masterClientAccountId: input.masterClientAccountId,
      destinationClientAccountId: match.destinationClientAccountId ?? null,
      destinationSubaccountIdGhl: match.destinationSubaccountIdGhl ?? null,
      sourceEventUuid: sourcePayload.event.event_uuid,
      sourceLeadUid: sourcePayload.contact.lead_uid,
      payload: sourcePayload,
      attribution: input,
      eventReceivedAt: now(),
    });
  } catch {
    /* duplicate-risk review must not block routing dry-run */
  }

  const eventsToEmit = lifecycleEventsToEmitForDryRun(match);
  for (const eventName of eventsToEmit) {
    const payload = buildRoutingLifecyclePayload(
      sourcePayload,
      eventName,
      match,
      decision.id
    );
    await persistEvent(payload);
  }

  return {
    matched: match.matched,
    confidence: match.confidence,
    matchType: match.matchType,
    matchedRuleId: match.matchedRuleId,
    destinationClientAccountId: match.destinationClientAccountId,
    destinationSubaccountIdGhl: match.destinationSubaccountIdGhl,
    reason: match.reason,
    deliveryMode: ROUTING_DELIVERY_MODE_DRY_RUN,
    routingEventNameInternal: primaryEvent,
    decisionId: decision.id,
    lifecycleEventsEmitted: eventsToEmit,
    routingAuthority,
    ...(sourceAssociation ? { sourceAssociation } : {}),
    ...(options.debug
      ? { matcherDebug: buildRoutingMatcherDebug(rules, input, now()) }
      : {}),
  };
}

/** Whether this lifecycle event should trigger routing dry-run. */
export function shouldRunRoutingDryRun(payload: LifecycleEventSchema): boolean {
  return payload.event.event_name_internal === "lead_created";
}

/** Persist a matched routing decision for operator-selected bulk import destinations (no campaign rule). */
export async function runManualBulkImportRoutingDryRun(
  input: {
    payload: LifecycleEventSchema;
    destinationClientAccountId: string;
    destinationLocationIdGhl: string;
    masterClientAccountId: string;
    matchReason?: string;
  },
  deps: Partial<RoutingDryRunServiceDeps> = {}
): Promise<RoutingDryRunOutput> {
  const { prisma: db } = { ...defaultDeps, ...deps };
  const attribution = extractRoutingAttributionFromPayload(input.payload);
  const attributionSnapshot = buildRoutingAttributionSnapshot(attribution, input.payload);
  const decision = await createRoutingDryRunDecision(
    {
      masterClientAccountId: input.masterClientAccountId,
      sourceEventUuid: input.payload.event.event_uuid,
      sourceLeadUid: input.payload.contact.lead_uid,
      matched: true,
      confidence: "high",
      matchedRuleId: null,
      destinationClientAccountId: input.destinationClientAccountId,
      destinationSubaccountIdGhl: input.destinationLocationIdGhl,
      matchReason:
        input.matchReason ?? "Operator-selected destination for bulk import batch",
      deliveryMode: ROUTING_DELIVERY_MODE_DRY_RUN,
      routingEventNameInternal: "lead_matched",
      attributionSnapshot: {
        ...(attributionSnapshot as Record<string, unknown>),
        matchType: "manual_bulk_import",
        routingAuthority: "operator_selected_destination",
      } as object,
    },
    db
  );

  try {
    await evaluateAndPersistDuplicateRiskForRoutingDecision({
      routingDryRunDecisionId: decision.id,
      masterClientAccountId: input.masterClientAccountId,
      destinationClientAccountId: input.destinationClientAccountId,
      destinationSubaccountIdGhl: input.destinationLocationIdGhl,
      sourceEventUuid: input.payload.event.event_uuid,
      sourceLeadUid: input.payload.contact.lead_uid,
      payload: input.payload,
      attribution,
      eventReceivedAt: new Date(),
    });
  } catch {
    /* duplicate-risk review must not block bulk import simulation */
  }

  return {
    matched: true,
    confidence: "high",
    matchType: "manual_bulk_import",
    matchedRuleId: undefined,
    destinationClientAccountId: input.destinationClientAccountId,
    destinationSubaccountIdGhl: input.destinationLocationIdGhl,
    reason: decision.matchReason,
    deliveryMode: ROUTING_DELIVERY_MODE_DRY_RUN,
    routingEventNameInternal: "lead_matched",
    decisionId: decision.id,
    lifecycleEventsEmitted: [],
    routingAuthority: ROUTING_AUTHORITY_OPERATOR_DESTINATION,
  };
}
