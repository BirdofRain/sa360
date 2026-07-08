import type { LeadOrder, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { FULFILLMENT_ALLOCATION_POLICY_VERSION } from "./fulfillment-keys.js";

export type ShadowMatchContext = {
  sourceLeadEventId: string;
  clientAccountId: string | null;
  campaignId: string | null;
  routingRuleId: string | null;
  nicheKey: string | null;
  productType: string | null;
  sourceLane: string | null;
  state: string | null;
};

export type ShadowMatchCandidate = LeadOrder & { remainingCapacity: number };

export type ShadowMatchResult =
  | {
      ok: true;
      selected: ShadowMatchCandidate;
      candidates: ShadowMatchCandidate[];
      decisionReasons: string[];
      policyVersion: string;
    }
  | {
      ok: false;
      candidates: ShadowMatchCandidate[];
      decisionReasons: string[];
      policyVersion: string;
      code: "no_matching_order" | "no_active_orders";
    };

function parseStatesJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim().toUpperCase()).filter(Boolean);
}

function parseSourceLanesJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
}

function isOrderActiveForMatching(order: LeadOrder): boolean {
  return order.status === "active" && !order.canceledAt && !order.completedAt;
}

function remainingCapacity(order: LeadOrder): number {
  const requested = order.requestedQuantity ?? order.leadVolume;
  const consumed = order.reservedQuantity + order.fulfilledQuantity;
  return Math.max(requested - consumed, 0);
}

function withinFulfillmentCycle(order: LeadOrder, at: Date): boolean {
  if (!order.fulfillmentCycleStart && !order.fulfillmentCycleEnd) return true;
  if (order.fulfillmentCycleStart && at < order.fulfillmentCycleStart) return false;
  if (order.fulfillmentCycleEnd && at > order.fulfillmentCycleEnd) return false;
  return true;
}

function matchesGeography(order: LeadOrder, state: string | null): boolean {
  if (!state) return true;
  const states = parseStatesJson(order.statesJson);
  if (states.length === 0) return true;
  return states.includes(state.trim().toUpperCase());
}

function matchesSourceLane(order: LeadOrder, sourceLane: string | null): boolean {
  const allowed = parseSourceLanesJson(order.allowedSourceLanesJson);
  if (allowed.length === 0) return true;
  if (!sourceLane) return false;
  return allowed.includes(sourceLane.trim().toLowerCase());
}

function matchesNicheProduct(
  order: LeadOrder,
  nicheKey: string | null,
  productType: string | null
): boolean {
  if (nicheKey && order.nicheKey.toLowerCase() !== nicheKey.toLowerCase()) return false;
  if (productType && order.productType && order.productType.toLowerCase() !== productType.toLowerCase()) {
    return false;
  }
  return true;
}

function sortCandidates(candidates: ShadowMatchCandidate[]): ShadowMatchCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.fulfillmentPriority !== a.fulfillmentPriority) {
      return b.fulfillmentPriority - a.fulfillmentPriority;
    }
    const aActivated = a.activatedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bActivated = b.activatedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (aActivated !== bActivated) return aActivated - bActivated;
    return a.id.localeCompare(b.id);
  });
}

export async function listActiveFulfillmentOrders(
  db: PrismaClient = prisma
): Promise<LeadOrder[]> {
  return db.leadOrder.findMany({
    where: {
      status: "active",
      canceledAt: null,
      completedAt: null,
      orderKind: { not: null },
      fulfillmentMode: { not: null },
    },
  });
}

export function matchRetainerCampaignBound(
  orders: LeadOrder[],
  context: ShadowMatchContext,
  at = new Date()
): ShadowMatchResult {
  const policyVersion = FULFILLMENT_ALLOCATION_POLICY_VERSION;
  const decisionReasons: string[] = [];

  const candidates = orders
    .filter((order) => {
      if (!isOrderActiveForMatching(order)) return false;
      if (order.orderKind !== "retainer_allocation") return false;
      if (order.fulfillmentMode !== "campaign_bound") return false;
      if (!withinFulfillmentCycle(order, at)) return false;
      if (!matchesSourceLane(order, context.sourceLane)) return false;
      if (!matchesNicheProduct(order, context.nicheKey, context.productType)) return false;
      if (!matchesGeography(order, context.state)) return false;
      if (context.campaignId && order.campaignId && order.campaignId !== context.campaignId) return false;
      if (context.routingRuleId && order.routingRuleId && order.routingRuleId !== context.routingRuleId) {
        return false;
      }
      if (
        context.clientAccountId &&
        order.clientAccountId.toLowerCase() !== context.clientAccountId.toLowerCase()
      ) {
        return false;
      }
      return true;
    })
    .map((order) => ({ ...order, remainingCapacity: remainingCapacity(order) }));

  if (candidates.length === 0) {
    decisionReasons.push("no_retainer_campaign_bound_match");
    return {
      ok: false,
      candidates: [],
      decisionReasons,
      policyVersion,
      code: "no_matching_order",
    };
  }

  const exactCampaignMatches = candidates.filter((order) => {
    if (!context.campaignId) return false;
    return order.campaignId === context.campaignId;
  });
  const exactRoutingMatches = candidates.filter((order) => {
    if (!context.routingRuleId) return false;
    return order.routingRuleId === context.routingRuleId;
  });

  const prioritizedPool =
    exactCampaignMatches.length > 0
      ? exactCampaignMatches
      : exactRoutingMatches.length > 0
        ? exactRoutingMatches
        : candidates;

  const selected = sortCandidates(prioritizedPool)[0];
  decisionReasons.push(
    exactCampaignMatches.length > 0
      ? "selected_exact_campaign_match"
      : exactRoutingMatches.length > 0
        ? "selected_exact_routing_rule_match"
        : "selected_retainer_campaign_bound_match"
  );

  return {
    ok: true,
    selected,
    candidates: sortCandidates(candidates),
    decisionReasons,
    policyVersion,
  };
}

export function matchPayPerLeadPooled(
  orders: LeadOrder[],
  context: ShadowMatchContext,
  at = new Date()
): ShadowMatchResult {
  const policyVersion = FULFILLMENT_ALLOCATION_POLICY_VERSION;
  const decisionReasons: string[] = [];

  const candidates = orders
    .filter((order) => {
      if (!isOrderActiveForMatching(order)) return false;
      if (order.orderKind !== "pay_per_lead") return false;
      if (order.fulfillmentMode !== "pooled_matching") return false;
      if (!withinFulfillmentCycle(order, at)) return false;
      if (!matchesSourceLane(order, context.sourceLane)) return false;
      if (!matchesNicheProduct(order, context.nicheKey, context.productType)) return false;
      if (!matchesGeography(order, context.state)) return false;
      return remainingCapacity(order) > 0;
    })
    .map((order) => ({ ...order, remainingCapacity: remainingCapacity(order) }));

  if (candidates.length === 0) {
    decisionReasons.push("no_pay_per_lead_pooled_match");
    return {
      ok: false,
      candidates: [],
      decisionReasons,
      policyVersion,
      code: "no_matching_order",
    };
  }

  const selected = sortCandidates(candidates)[0];
  decisionReasons.push("selected_pooled_pay_per_lead_match");

  return {
    ok: true,
    selected,
    candidates: sortCandidates(candidates),
    decisionReasons,
    policyVersion,
  };
}

export function resolveShadowMatch(
  orders: LeadOrder[],
  context: ShadowMatchContext,
  at = new Date()
): ShadowMatchResult {
  const retainer = matchRetainerCampaignBound(orders, context, at);
  if (retainer.ok) return retainer;
  return matchPayPerLeadPooled(orders, context, at);
}
