import type { CampaignRoutingRule, LifecycleEvent, RoutingDryRunDecision } from "@prisma/client";
import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import { prisma } from "../lib/db.js";

export type RoutingDryRunMatchedRuleSummary = {
  id: string;
  clientDisplayName: string | null;
  clientAccountId: string;
  nicheKey: string | null;
  productType: string | null;
  matchType: string;
};

export type RoutingDryRunLeadIdentity = {
  contactIdGhl: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  phoneE164: string | null;
  email: string | null;
};

export type RoutingDryRunDecisionItem = {
  id: string;
  createdAt: string;
  sourceEventUuid: string | null;
  sourceLeadUid: string;
  matched: boolean;
  confidence: string;
  matchType: string | null;
  matchedRuleId: string | null;
  matchedRuleSummary: RoutingDryRunMatchedRuleSummary | null;
  destinationClientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  reason: string;
  deliveryMode: string;
  routingEventNameInternal: string;
  attributionSnapshot: unknown;
  lifecycleEventsEmitted: string[];
  leadIdentity: RoutingDryRunLeadIdentity | null;
  masterClientAccountId: string;
};

export function parseMatchTypeFromReason(reason: string): string | null {
  const m = reason.match(/Matched routing rule \(([^)]+)\)/);
  return m?.[1]?.trim() ?? null;
}

function leadIdentityFromPayload(
  payload: LifecycleEventSchema | undefined,
  contactIdGhl: string | null | undefined
): RoutingDryRunLeadIdentity | null {
  if (!payload?.contact && !contactIdGhl) return null;
  const c = payload?.contact;
  const first = c?.first_name?.trim() || null;
  const last = c?.last_name?.trim() || null;
  const display =
    [first, last].filter(Boolean).join(" ").trim() ||
    c?.email?.trim() ||
    null;
  return {
    contactIdGhl: contactIdGhl ?? c?.contact_id_ghl?.trim() ?? null,
    firstName: first,
    lastName: last,
    displayName: display || null,
    phoneE164: c?.phone_e164?.trim() || c?.phone?.trim() || null,
    email: c?.email?.trim() || null,
  };
}

function lifecycleEventsForRow(row: Pick<RoutingDryRunDecision, "matched" | "routingEventNameInternal">): string[] {
  if (!row.matched) {
    return [row.routingEventNameInternal || "routing_review_required"];
  }
  return ["lead_matched", "lead_routed_dry_run"];
}

export async function presentRoutingDryRunDecisions(
  rows: RoutingDryRunDecision[]
): Promise<RoutingDryRunDecisionItem[]> {
  const ruleIds = [
    ...new Set(rows.map((r) => r.matchedRuleId).filter((id): id is string => Boolean(id))),
  ];
  const rules: CampaignRoutingRule[] =
    ruleIds.length > 0
      ? await prisma.campaignRoutingRule.findMany({ where: { id: { in: ruleIds } } })
      : [];

  const ruleMap = new Map(rules.map((r) => [r.id, r]));

  const eventUuids = [
    ...new Set(rows.map((r) => r.sourceEventUuid).filter((id): id is string => Boolean(id))),
  ];
  const events: Pick<LifecycleEvent, "eventUuid" | "contactIdGhl" | "payloadJson">[] =
    eventUuids.length > 0
      ? await prisma.lifecycleEvent.findMany({
          where: { eventUuid: { in: eventUuids } },
          select: { eventUuid: true, contactIdGhl: true, payloadJson: true },
        })
      : [];

  const eventMap = new Map(events.map((e) => [e.eventUuid, e]));

  return rows.map((row) => {
    const rule = row.matchedRuleId ? ruleMap.get(row.matchedRuleId) : undefined;
    const ev = row.sourceEventUuid ? eventMap.get(row.sourceEventUuid) : undefined;
    const payload = ev?.payloadJson as LifecycleEventSchema | undefined;

    const matchedRuleSummary: RoutingDryRunMatchedRuleSummary | null = rule
      ? {
          id: rule.id,
          clientDisplayName: rule.clientDisplayName,
          clientAccountId: rule.clientAccountId,
          nicheKey: rule.nicheKey,
          productType: rule.productType,
          matchType: rule.matchType,
        }
      : null;

    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      sourceEventUuid: row.sourceEventUuid,
      sourceLeadUid: row.sourceLeadUid,
      matched: row.matched,
      confidence: row.confidence,
      matchType: rule?.matchType ?? parseMatchTypeFromReason(row.matchReason),
      matchedRuleId: row.matchedRuleId,
      matchedRuleSummary,
      destinationClientAccountId: row.destinationClientAccountId,
      destinationSubaccountIdGhl: row.destinationSubaccountIdGhl,
      reason: row.matchReason,
      deliveryMode: row.deliveryMode,
      routingEventNameInternal: row.routingEventNameInternal,
      attributionSnapshot: row.attributionSnapshot,
      lifecycleEventsEmitted: lifecycleEventsForRow(row),
      leadIdentity: leadIdentityFromPayload(payload, ev?.contactIdGhl ?? payload?.contact?.contact_id_ghl),
      masterClientAccountId: row.masterClientAccountId,
    };
  });
}
