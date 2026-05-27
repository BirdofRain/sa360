import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import type { LifecycleEventNameInternal } from "../schemas/lifecycle-event-names.js";
import { prisma } from "../lib/db.js";
import {
  extractRoutingAttributionFromPayload,
  type RoutingAttributionInput,
} from "../lib/routing-attribution-extract.js";
import { listActiveCampaignRoutingRules } from "../repositories/campaign-routing-rule.repository.js";
import { createRoutingDryRunDecision } from "../repositories/routing-dry-run-decision.repository.js";
import { saveLifecycleEvent } from "./event-service.js";
import {
  matchCampaignRoutingRule,
  type RoutingMatchResult,
} from "./routing-matcher.service.js";

export const ROUTING_DELIVERY_MODE_DRY_RUN = "dry_run" as const;

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
};

export type RoutingDryRunServiceDeps = {
  prisma: PrismaClient;
  now: () => Date;
  saveLifecycleEvent: (payload: LifecycleEventSchema) => Promise<unknown>;
};

const defaultDeps: RoutingDryRunServiceDeps = {
  prisma,
  now: () => new Date(),
  saveLifecycleEvent,
};

function routingEventForMatch(match: RoutingMatchResult): LifecycleEventNameInternal {
  if (!match.matched) return "routing_review_required";
  return "lead_matched";
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
  deps: Partial<RoutingDryRunServiceDeps> = {}
): Promise<RoutingDryRunOutput> {
  const { prisma: db, now, saveLifecycleEvent: persistEvent } = {
    ...defaultDeps,
    ...deps,
  };
  const input: RoutingAttributionInput =
    extractRoutingAttributionFromPayload(sourcePayload);
  const rules = await listActiveCampaignRoutingRules(input.masterClientAccountId, db);
  const match = matchCampaignRoutingRule(rules, input, now());

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
      attributionSnapshot: input as unknown as object,
    },
    db
  );

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
  };
}

/** Whether this lifecycle event should trigger routing dry-run. */
export function shouldRunRoutingDryRun(payload: LifecycleEventSchema): boolean {
  return payload.event.event_name_internal === "lead_created";
}
