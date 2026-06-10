import type { CampaignRoutingRule, LifecycleEvent, RoutingDryRunDecision } from "@prisma/client";
import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import { prisma } from "../lib/db.js";
import { findDeliveryPlanSummariesByDecisionIds } from "../repositories/lead-delivery-plan.repository.js";
import type { LeadDeliveryPlanSummary } from "./lead-delivery-plan-admin.present.js";
import {
  suggestLegacyPrefill,
  suggestRoutingValidation,
  type LegacyPrefillSuggestion,
  type RoutingValidationSuggestion,
} from "./routing-validation-suggest.service.js";
import {
  evaluateDeliveryReadiness,
  type DeliveryReadinessAssessment,
} from "./delivery-readiness.service.js";
import {
  ruleToReadinessInput,
  type ClientDestinationFieldMapping,
} from "./delivery-readiness-admin.present.js";
import {
  findDuplicateRiskByDecisionIds,
} from "../repositories/lead-duplicate-risk.repository.js";
import {
  mergeDuplicateRiskIntoReadiness,
  presentDuplicateRiskAssessment,
} from "./lead-identity/lead-identity-correlation.service.js";
import type { DuplicateRiskAssessmentItem } from "./lead-identity/lead-identity.types.js";

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

export type RoutingDryRunValidationFields = {
  legacyDeliveredClientAccountId: string | null;
  legacyDeliveredSubaccountIdGhl: string | null;
  legacyDeliveryContactIdGhl: string | null;
  legacyDeliveryStatus: string | null;
  validationStatus: string | null;
  validationNotes: string | null;
  validatedAt: string | null;
  validatedBy: string | null;
};

export type { LegacyPrefillSuggestion, RoutingValidationSuggestion };

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
  deliveryPlanSummary: LeadDeliveryPlanSummary | null;
  suggestedValidation: RoutingValidationSuggestion;
  suggestedLegacyPrefill: LegacyPrefillSuggestion;
  deliveryReadiness: DeliveryReadinessAssessment | null;
  duplicateRisk: DuplicateRiskAssessmentItem | null;
} & RoutingDryRunValidationFields;

export function parseMatchTypeFromReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
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

function validationFieldsFromRow(
  row: RoutingDryRunDecision
): RoutingDryRunValidationFields {
  return {
    legacyDeliveredClientAccountId: row.legacyDeliveredClientAccountId,
    legacyDeliveredSubaccountIdGhl: row.legacyDeliveredSubaccountIdGhl,
    legacyDeliveryContactIdGhl: row.legacyDeliveryContactIdGhl,
    legacyDeliveryStatus: row.legacyDeliveryStatus,
    validationStatus: row.validationStatus,
    validationNotes: row.validationNotes,
    validatedAt: row.validatedAt?.toISOString() ?? null,
    validatedBy: row.validatedBy,
  };
}

type LifecycleEventContext = Pick<
  LifecycleEvent,
  "eventUuid" | "contactIdGhl" | "payloadJson" | "clientAccountId" | "subaccountIdGhl" | "status"
>;

type PresentContext = {
  ruleMap: Map<string, CampaignRoutingRule>;
  destinationByClientId: Map<string, ClientDestinationFieldMapping>;
  eventMap: Map<string, LifecycleEventContext>;
  planMap: Map<string, LeadDeliveryPlanSummary>;
  duplicateRiskMap: Map<string, DuplicateRiskAssessmentItem>;
};

function buildSuggestions(
  row: RoutingDryRunDecision,
  leadIdentity: RoutingDryRunLeadIdentity | null,
  ev: LifecycleEventContext | undefined
): {
  suggestedValidation: RoutingValidationSuggestion;
  suggestedLegacyPrefill: LegacyPrefillSuggestion;
} {
  try {
    return buildSuggestionsUnsafe(row, leadIdentity, ev);
  } catch {
    return {
      suggestedValidation: FALLBACK_VALIDATION_SUGGESTION,
      suggestedLegacyPrefill: EMPTY_LEGACY_PREFILL,
    };
  }
}

function buildSuggestionsUnsafe(
  row: RoutingDryRunDecision,
  leadIdentity: RoutingDryRunLeadIdentity | null,
  ev: LifecycleEventContext | undefined
): {
  suggestedValidation: RoutingValidationSuggestion;
  suggestedLegacyPrefill: LegacyPrefillSuggestion;
} {
  const payload = ev?.payloadJson as LifecycleEventSchema | undefined;
  const suggestedValidation = suggestRoutingValidation({
    matched: row.matched,
    routingEventNameInternal: row.routingEventNameInternal,
    destinationClientAccountId: row.destinationClientAccountId,
    destinationSubaccountIdGhl: row.destinationSubaccountIdGhl,
    legacyDeliveredClientAccountId: row.legacyDeliveredClientAccountId,
    legacyDeliveredSubaccountIdGhl: row.legacyDeliveredSubaccountIdGhl,
    legacyDeliveryContactIdGhl: row.legacyDeliveryContactIdGhl,
    legacyDeliveryStatus: row.legacyDeliveryStatus,
    validationStatus: row.validationStatus,
    sourceLeadUid: row.sourceLeadUid,
    leadIdentity,
  });
  const suggestedLegacyPrefill = suggestLegacyPrefill({
    legacyDeliveredClientAccountId: row.legacyDeliveredClientAccountId,
    legacyDeliveredSubaccountIdGhl: row.legacyDeliveredSubaccountIdGhl,
    legacyDeliveryContactIdGhl: row.legacyDeliveryContactIdGhl,
    legacyDeliveryStatus: row.legacyDeliveryStatus,
    destinationClientAccountId: row.destinationClientAccountId,
    matched: row.matched,
    lifecycleClientAccountId: ev?.clientAccountId ?? payload?.client_account_id ?? null,
    lifecycleSubaccountIdGhl:
      ev?.subaccountIdGhl ?? payload?.subaccount_id_ghl ?? null,
    lifecycleContactIdGhl:
      ev?.contactIdGhl ?? payload?.contact?.contact_id_ghl ?? null,
    lifecycleEventStatus: ev?.status ?? null,
  });
  return { suggestedValidation, suggestedLegacyPrefill };
}

const EMPTY_LEGACY_PREFILL: LegacyPrefillSuggestion = {
  legacyDeliveredClientAccountId: null,
  legacyDeliveredSubaccountIdGhl: null,
  legacyDeliveryContactIdGhl: null,
  legacyDeliveryStatus: null,
  prefillReason: null,
  prefillConfidence: null,
};

const FALLBACK_VALIDATION_SUGGESTION: RoutingValidationSuggestion = {
  suggestedValidationStatus: "legacy_unknown",
  suggestedValidationReason: "Presentation fallback — row could not be fully enriched.",
  suggestionConfidence: "low",
};

/** Minimal item when per-row presentation fails (avoids 500 on entire list). */
export function fallbackRoutingDryRunDecisionItem(
  row: RoutingDryRunDecision
): RoutingDryRunDecisionItem {
  const validation = validationFieldsFromRow(row);
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    sourceEventUuid: row.sourceEventUuid,
    sourceLeadUid: row.sourceLeadUid,
    matched: row.matched,
    confidence: row.confidence ?? "unknown",
    matchType: parseMatchTypeFromReason(row.matchReason),
    matchedRuleId: row.matchedRuleId,
    matchedRuleSummary: null,
    destinationClientAccountId: row.destinationClientAccountId,
    destinationSubaccountIdGhl: row.destinationSubaccountIdGhl,
    reason: row.matchReason ?? "",
    deliveryMode: row.deliveryMode,
    routingEventNameInternal: row.routingEventNameInternal,
    attributionSnapshot: row.attributionSnapshot,
    lifecycleEventsEmitted: lifecycleEventsForRow(row),
    leadIdentity: null,
    masterClientAccountId: row.masterClientAccountId,
    deliveryPlanSummary: null,
    suggestedValidation: FALLBACK_VALIDATION_SUGGESTION,
    suggestedLegacyPrefill: EMPTY_LEGACY_PREFILL,
    deliveryReadiness: null,
    duplicateRisk: null,
    ...validation,
  };
}

function mapRowToItem(row: RoutingDryRunDecision, ctx: PresentContext): RoutingDryRunDecisionItem {
  const rule = row.matchedRuleId ? ctx.ruleMap.get(row.matchedRuleId) : undefined;
  const ev = row.sourceEventUuid ? ctx.eventMap.get(row.sourceEventUuid) : undefined;
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

  const leadIdentity = leadIdentityFromPayload(
    payload,
    ev?.contactIdGhl ?? payload?.contact?.contact_id_ghl
  );
  const { suggestedValidation, suggestedLegacyPrefill } = buildSuggestions(row, leadIdentity, ev);
  const duplicateRisk = ctx.duplicateRiskMap.get(row.id) ?? null;
  let deliveryReadiness: DeliveryReadinessAssessment | null = null;
  if (rule) {
    try {
      const baseReadiness = evaluateDeliveryReadiness(
        ruleToReadinessInput(rule, ctx.destinationByClientId.get(rule.clientAccountId) ?? null)
      );
      deliveryReadiness = mergeDuplicateRiskIntoReadiness(duplicateRisk, baseReadiness);
    } catch {
      deliveryReadiness = null;
    }
  }

  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    sourceEventUuid: row.sourceEventUuid,
    sourceLeadUid: row.sourceLeadUid ?? "",
    matched: row.matched,
    confidence: row.confidence?.trim() || "unknown",
    matchType: rule?.matchType ?? parseMatchTypeFromReason(row.matchReason ?? ""),
    matchedRuleId: row.matchedRuleId,
    matchedRuleSummary,
    destinationClientAccountId: row.destinationClientAccountId,
    destinationSubaccountIdGhl: row.destinationSubaccountIdGhl,
    reason: row.matchReason ?? "",
    deliveryMode: row.deliveryMode ?? "dry_run",
    routingEventNameInternal:
      row.routingEventNameInternal ?? "routing_review_required",
    attributionSnapshot: row.attributionSnapshot,
    lifecycleEventsEmitted: lifecycleEventsForRow(row),
    leadIdentity,
    masterClientAccountId: row.masterClientAccountId,
    deliveryPlanSummary: ctx.planMap.get(row.id) ?? null,
    suggestedValidation,
    suggestedLegacyPrefill,
    deliveryReadiness,
    duplicateRisk,
    ...validationFieldsFromRow(row),
  };
}

async function buildPresentContext(rows: RoutingDryRunDecision[]): Promise<PresentContext> {
  const ruleIds = [
    ...new Set(rows.map((r) => r.matchedRuleId).filter((id): id is string => Boolean(id))),
  ];
  const rules: CampaignRoutingRule[] =
    ruleIds.length > 0
      ? await prisma.campaignRoutingRule.findMany({ where: { id: { in: ruleIds } } })
      : [];

  const eventUuids = [
    ...new Set(rows.map((r) => r.sourceEventUuid).filter((id): id is string => Boolean(id))),
  ];
  const events: LifecycleEventContext[] =
    eventUuids.length > 0
      ? await prisma.lifecycleEvent.findMany({
          where: { eventUuid: { in: eventUuids } },
          select: {
            eventUuid: true,
            contactIdGhl: true,
            payloadJson: true,
            clientAccountId: true,
            subaccountIdGhl: true,
            status: true,
          },
        })
      : [];

  const decisionIds = rows.map((r) => r.id);
  const planRows = await findDeliveryPlanSummariesByDecisionIds(decisionIds);
  const planMap = new Map<string, LeadDeliveryPlanSummary>();
  for (const p of planRows) {
    if (p.routingDryRunDecisionId) {
      planMap.set(p.routingDryRunDecisionId, {
        id: p.id,
        status: p.status,
        generatedAt: p.generatedAt.toISOString(),
      });
    }
  }

  const riskRows = await findDuplicateRiskByDecisionIds(decisionIds);
  const duplicateRiskMap = new Map<string, DuplicateRiskAssessmentItem>();
  for (const r of riskRows) {
    if (!r.routingDryRunDecisionId) continue;
    try {
      duplicateRiskMap.set(
        r.routingDryRunDecisionId,
        presentDuplicateRiskAssessment(r)
      );
    } catch {
      /* skip malformed duplicate-risk row */
    }
  }

  const clientIds = [...new Set(rules.map((r) => r.clientAccountId))];
  const destinations =
    clientIds.length > 0
      ? await prisma.clientGhlDestination.findMany({
          where: { clientAccountId: { in: clientIds } },
        })
      : [];
  const destinationByClientId = new Map(
    destinations.map((d) => [
      d.clientAccountId,
      {
        sa360CustomFieldIdMapJson: d.sa360CustomFieldIdMapJson,
        customFieldStampRequired: d.customFieldStampRequired,
        ownerAssignmentRequired: d.ownerAssignmentRequired,
        workflowStartRequired: d.workflowStartRequired,
      },
    ])
  );

  return {
    ruleMap: new Map(rules.map((r) => [r.id, r])),
    destinationByClientId,
    eventMap: new Map(events.map((e) => [e.eventUuid, e])),
    planMap,
    duplicateRiskMap,
  };
}

export async function presentRoutingDryRunDecision(
  row: RoutingDryRunDecision
): Promise<RoutingDryRunDecisionItem> {
  const ctx = await buildPresentContext([row]);
  return mapRowToItem(row, ctx);
}

function safeMapRowToItem(
  row: RoutingDryRunDecision,
  ctx: PresentContext
): RoutingDryRunDecisionItem {
  try {
    return mapRowToItem(row, ctx);
  } catch {
    return fallbackRoutingDryRunDecisionItem(row);
  }
}

export async function presentRoutingDryRunDecisions(
  rows: RoutingDryRunDecision[]
): Promise<RoutingDryRunDecisionItem[]> {
  if (rows.length === 0) return [];
  let ctx: PresentContext;
  try {
    ctx = await buildPresentContext(rows);
  } catch {
    return rows.map((row) => fallbackRoutingDryRunDecisionItem(row));
  }
  return rows.map((row) => safeMapRowToItem(row, ctx));
}
