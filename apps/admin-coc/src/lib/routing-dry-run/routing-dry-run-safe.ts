import type { DeliveryReadinessAssessment } from "../delivery-readiness/types.ts";
import type { DuplicateRiskAssessmentItem } from "./duplicate-risk-types.ts";
import {
  defaultRoutingValidationSuggestion,
  emptyLegacyPrefillSuggestion,
} from "./routing-dry-run-suggestion-fixture.ts";
import type {
  LegacyPrefillSuggestion,
  LeadDeliveryPlanItem,
  LeadDeliveryPlanSummary,
  RoutingDryRunDecisionItem,
  RoutingDryRunLeadIdentity,
  RoutingDryRunMatchedRuleSummary,
  RoutingDryRunTestResult,
  RoutingValidationSuggestion,
} from "./types.ts";

export const ROUTING_DRY_RUN_ACTION_FAILED =
  "Routing dry-run action failed. Check server logs.";

export const DELIVERY_PLAN_BLOCKED_MESSAGE =
  "Delivery plan cannot be generated until the decision is matched and delivery config is complete.";

export const ROUTING_DRY_RUN_ROW_UNAVAILABLE =
  "Row unavailable — check server logs";

export type RoutingDryRunDecisionView = RoutingDryRunDecisionItem & {
  rowPresentable: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strOrEmpty(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSuggestion(raw: unknown): RoutingValidationSuggestion {
  if (!isRecord(raw)) return defaultRoutingValidationSuggestion;
  const confidence = raw.suggestionConfidence;
  const suggestionConfidence =
    confidence === "high" || confidence === "medium" || confidence === "low"
      ? confidence
      : defaultRoutingValidationSuggestion.suggestionConfidence;
  return {
    suggestedValidationStatus: strOrEmpty(
      raw.suggestedValidationStatus,
      defaultRoutingValidationSuggestion.suggestedValidationStatus
    ),
    suggestedValidationReason: strOrEmpty(
      raw.suggestedValidationReason,
      defaultRoutingValidationSuggestion.suggestedValidationReason
    ),
    suggestionConfidence,
  };
}

function normalizeLegacyPrefill(raw: unknown): LegacyPrefillSuggestion {
  if (!isRecord(raw)) return emptyLegacyPrefillSuggestion;
  const conf = raw.prefillConfidence;
  const prefillConfidence =
    conf === "high" || conf === "medium" || conf === "low" ? conf : null;
  return {
    legacyDeliveredClientAccountId: strOrNull(raw.legacyDeliveredClientAccountId),
    legacyDeliveredSubaccountIdGhl: strOrNull(raw.legacyDeliveredSubaccountIdGhl),
    legacyDeliveryContactIdGhl: strOrNull(raw.legacyDeliveryContactIdGhl),
    legacyDeliveryStatus: strOrNull(raw.legacyDeliveryStatus),
    prefillReason: strOrNull(raw.prefillReason),
    prefillConfidence,
  };
}

function normalizeMatchedRuleSummary(raw: unknown): RoutingDryRunMatchedRuleSummary | null {
  if (!isRecord(raw)) return null;
  const id = strOrNull(raw.id);
  if (!id) return null;
  return {
    id,
    clientDisplayName: strOrNull(raw.clientDisplayName),
    clientAccountId: strOrEmpty(raw.clientAccountId, "—"),
    nicheKey: strOrNull(raw.nicheKey),
    productType: strOrNull(raw.productType),
    matchType: strOrEmpty(raw.matchType, "unknown"),
  };
}

function normalizeLeadIdentity(raw: unknown): RoutingDryRunLeadIdentity | null {
  if (!isRecord(raw)) return null;
  return {
    contactIdGhl: strOrNull(raw.contactIdGhl),
    firstName: strOrNull(raw.firstName),
    lastName: strOrNull(raw.lastName),
    displayName: strOrNull(raw.displayName),
    phoneE164: strOrNull(raw.phoneE164),
    email: strOrNull(raw.email),
  };
}

function normalizePlanSummary(raw: unknown): LeadDeliveryPlanSummary | null {
  if (!isRecord(raw)) return null;
  const id = strOrNull(raw.id);
  const status = strOrNull(raw.status);
  const generatedAt = strOrNull(raw.generatedAt);
  if (!id || !status || !generatedAt) return null;
  // A plan summary only exists when a plan was recorded; default to "shadow"
  // (the only mode this system records during cutover rehearsal).
  return { id, status, deliveryMode: strOrEmpty(raw.deliveryMode, "shadow"), generatedAt };
}

/**
 * Coerce a delivery plan returned by generate/load actions so the delivery section
 * never crashes on a partial or unexpected API shape (e.g. null `warnings`/`steps`,
 * or steps missing `id`). Does not invent plan content — only guarantees render-safe types.
 */
export function normalizeLeadDeliveryPlan(raw: unknown): LeadDeliveryPlanItem | null {
  if (!isRecord(raw)) return null;
  const id = strOrNull(raw.id);
  if (!id) return null;
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((x): x is string => typeof x === "string")
    : [];
  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
  const steps: LeadDeliveryPlanItem["steps"] = [];
  let index = 0;
  for (const s of stepsRaw) {
    if (!isRecord(s)) continue;
    const stepId = strOrNull(s.id) ?? `step-${index}`;
    const stepWarnings = Array.isArray(s.warnings)
      ? s.warnings.filter((x): x is string => typeof x === "string")
      : [];
    steps.push({
      id: stepId,
      stepOrder:
        typeof s.stepOrder === "number" && Number.isFinite(s.stepOrder) ? s.stepOrder : index + 1,
      stepType: strOrEmpty(s.stepType, "unknown"),
      status: strOrEmpty(s.status, "unknown"),
      title: strOrEmpty(s.title, ""),
      description: strOrNull(s.description),
      targetSystem: strOrNull(s.targetSystem),
      targetId: strOrNull(s.targetId),
      requestPreviewJson: sanitizeJsonValue(s.requestPreviewJson),
      resultPreviewJson: sanitizeJsonValue(s.resultPreviewJson),
      warnings: stepWarnings,
    });
    index += 1;
  }
  return {
    id,
    routingDryRunDecisionId: strOrNull(raw.routingDryRunDecisionId),
    status: strOrEmpty(raw.status, "unknown"),
    deliveryMode: strOrEmpty(raw.deliveryMode, "shadow"),
    summary: strOrNull(raw.summary),
    warnings,
    generatedAt: strOrEmpty(raw.generatedAt, new Date(0).toISOString()),
    steps,
  };
}

export function normalizeDuplicateRisk(raw: unknown): DuplicateRiskAssessmentItem | null {
  if (!isRecord(raw)) return null;
  const id = strOrNull(raw.id);
  if (!id) return null;
  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons.filter((x): x is string => typeof x === "string")
    : [];
  const candidateMatches = Array.isArray(raw.candidateMatches) ? raw.candidateMatches : [];
  const normalizedCandidates: DuplicateRiskAssessmentItem["candidateMatches"] = [];
  for (const m of candidateMatches) {
    if (!isRecord(m) || typeof m.matchType !== "string") continue;
    normalizedCandidates.push({
      matchType: m.matchType,
      confidence: strOrEmpty(m.confidence, "unknown"),
      existingLeadUid: strOrNull(m.existingLeadUid),
      existingContactIdGhl: strOrNull(m.existingContactIdGhl),
      existingEventUuid: strOrNull(m.existingEventUuid),
      existingClientAccountId: strOrNull(m.existingClientAccountId),
      existingSubaccountIdGhl: strOrNull(m.existingSubaccountIdGhl),
      detail: strOrEmpty(m.detail, ""),
      matchedAt: strOrNull(m.matchedAt),
    });
  }
  return {
    id,
    masterClientAccountId: strOrEmpty(raw.masterClientAccountId, ""),
    destinationClientAccountId: strOrNull(raw.destinationClientAccountId),
    destinationSubaccountIdGhl: strOrNull(raw.destinationSubaccountIdGhl),
    sourceEventUuid: strOrNull(raw.sourceEventUuid),
    sourceLeadUid: strOrNull(raw.sourceLeadUid),
    routingDryRunDecisionId: strOrNull(raw.routingDryRunDecisionId),
    leadDeliveryPlanId: strOrNull(raw.leadDeliveryPlanId),
    identityStatus: strOrEmpty(raw.identityStatus, "unknown"),
    riskLevel: strOrEmpty(raw.riskLevel, "unknown"),
    confidence: strOrEmpty(raw.confidence, "unknown"),
    recommendedAction: strOrEmpty(raw.recommendedAction, ""),
    reasons,
    candidateMatches: normalizedCandidates,
    blocksLiveDelivery: bool(raw.blocksLiveDelivery),
    isWarningOnly: bool(raw.isWarningOnly),
    operatorOverrideStatus: strOrNull(raw.operatorOverrideStatus),
    operatorNotes: strOrNull(raw.operatorNotes),
    operatorUpdatedAt: strOrNull(raw.operatorUpdatedAt),
    operatorUpdatedBy: strOrNull(raw.operatorUpdatedBy),
    evaluatedAt: strOrEmpty(raw.evaluatedAt, new Date(0).toISOString()),
  };
}

function sanitizeJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return null;
  }
}

function normalizeReadiness(raw: unknown): DeliveryReadinessAssessment | null {
  if (!isRecord(raw)) return null;
  const blockers = Array.isArray(raw.blockers)
    ? raw.blockers.filter((x): x is string => typeof x === "string")
    : [];
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((x): x is string => typeof x === "string")
    : [];
  const missingConfig = Array.isArray(raw.missingConfig)
    ? raw.missingConfig.filter((x): x is string => typeof x === "string")
    : [];
  const requiredApprovals = Array.isArray(raw.requiredApprovals)
    ? raw.requiredApprovals.filter((x): x is string => typeof x === "string")
    : [];
  const checklist = Array.isArray(raw.checklist) ? raw.checklist : [];
  const fieldMappingRaw = isRecord(raw.fieldMapping) ? raw.fieldMapping : null;
  const stringListField = (value: unknown) =>
    Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  const fieldMapping = fieldMappingRaw
    ? {
        source: strOrEmpty(fieldMappingRaw.source, "none"),
        coreRequiredMapped: stringListField(fieldMappingRaw.coreRequiredMapped),
        coreRequiredMissing: stringListField(fieldMappingRaw.coreRequiredMissing),
        optionalMapped: stringListField(fieldMappingRaw.optionalMapped),
        optionalMissing: stringListField(fieldMappingRaw.optionalMissing),
        customFieldStampRequired: bool(fieldMappingRaw.customFieldStampRequired),
        coreRequiredComplete: bool(fieldMappingRaw.coreRequiredComplete),
      }
    : undefined;
  return {
    ruleId: strOrNull(raw.ruleId),
    clientAccountId: strOrEmpty(raw.clientAccountId),
    destinationSubaccountIdGhl: strOrNull(raw.destinationSubaccountIdGhl),
    clientDisplayName: strOrNull(raw.clientDisplayName),
    readyForShadow: bool(raw.readyForShadow),
    readyForDirectCanary: bool(raw.readyForDirectCanary),
    readyForLive: bool(raw.readyForLive),
    canDeliverLive: bool(raw.canDeliverLive),
    readinessStatus: strOrEmpty(raw.readinessStatus, "needs_config"),
    blockers,
    warnings,
    missingConfig,
    requiredApprovals,
    recommendedNextAction: strOrEmpty(
      raw.recommendedNextAction,
      "Review routing rule delivery configuration."
    ),
    checklist: checklist.filter(
      (c): c is DeliveryReadinessAssessment["checklist"][number] =>
        isRecord(c) && typeof c.key === "string" && typeof c.label === "string"
    ),
    fieldMapping,
  };
}

function minimalUnavailableRow(partialId?: string): RoutingDryRunDecisionView {
  return {
    id: partialId?.trim() || "unavailable-row",
    createdAt: new Date(0).toISOString(),
    sourceEventUuid: null,
    sourceLeadUid: "—",
    matched: false,
    confidence: "unknown",
    matchType: null,
    matchedRuleId: null,
    matchedRuleSummary: null,
    destinationClientAccountId: null,
    destinationSubaccountIdGhl: null,
    reason: ROUTING_DRY_RUN_ROW_UNAVAILABLE,
    deliveryMode: "dry_run",
    routingEventNameInternal: "routing_review_required",
    attributionSnapshot: null,
    lifecycleEventsEmitted: [],
    leadIdentity: null,
    masterClientAccountId: "",
    deliveryPlanSummary: null,
    suggestedValidation: defaultRoutingValidationSuggestion,
    suggestedLegacyPrefill: emptyLegacyPrefillSuggestion,
    deliveryReadiness: null,
    duplicateRisk: null,
    legacyDeliveredClientAccountId: null,
    legacyDeliveredSubaccountIdGhl: null,
    legacyDeliveryContactIdGhl: null,
    legacyDeliveryStatus: null,
    validationStatus: null,
    validationNotes: null,
    validatedAt: null,
    validatedBy: null,
    rowPresentable: false,
  };
}

/** Coerce API/list payloads so client components never crash on partial rows. */
export function normalizeRoutingDryRunDecisionItem(
  raw: RoutingDryRunDecisionItem | Record<string, unknown>
): RoutingDryRunDecisionItem {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    const { rowPresentable: _rp, ...item } = minimalUnavailableRow();
    return item;
  }
  const r = raw as Record<string, unknown>;
  const lifecycleEventsEmitted = Array.isArray(r.lifecycleEventsEmitted)
    ? r.lifecycleEventsEmitted.filter((x): x is string => typeof x === "string")
    : [];

  return {
    id: strOrEmpty(r.id, "unknown"),
    createdAt: strOrEmpty(r.createdAt, new Date(0).toISOString()),
    sourceEventUuid: strOrNull(r.sourceEventUuid),
    sourceLeadUid: strOrEmpty(r.sourceLeadUid, "—"),
    matched: bool(r.matched),
    confidence: strOrEmpty(r.confidence, "unknown"),
    matchType: strOrNull(r.matchType),
    matchedRuleId: strOrNull(r.matchedRuleId),
    matchedRuleSummary: normalizeMatchedRuleSummary(r.matchedRuleSummary),
    destinationClientAccountId: strOrNull(r.destinationClientAccountId),
    destinationSubaccountIdGhl: strOrNull(r.destinationSubaccountIdGhl),
    reason: strOrEmpty(r.reason, ""),
    deliveryMode: strOrEmpty(r.deliveryMode, "dry_run"),
    routingEventNameInternal: strOrEmpty(r.routingEventNameInternal, "routing_review_required"),
    attributionSnapshot: sanitizeJsonValue(r.attributionSnapshot),
    lifecycleEventsEmitted,
    leadIdentity: normalizeLeadIdentity(r.leadIdentity),
    masterClientAccountId: strOrEmpty(r.masterClientAccountId, ""),
    deliveryPlanSummary: normalizePlanSummary(r.deliveryPlanSummary),
    suggestedValidation: normalizeSuggestion(r.suggestedValidation),
    suggestedLegacyPrefill: normalizeLegacyPrefill(r.suggestedLegacyPrefill),
    deliveryReadiness: normalizeReadiness(r.deliveryReadiness),
    duplicateRisk: normalizeDuplicateRisk(r.duplicateRisk),
    legacyDeliveredClientAccountId: strOrNull(r.legacyDeliveredClientAccountId),
    legacyDeliveredSubaccountIdGhl: strOrNull(r.legacyDeliveredSubaccountIdGhl),
    legacyDeliveryContactIdGhl: strOrNull(r.legacyDeliveryContactIdGhl),
    legacyDeliveryStatus: strOrNull(r.legacyDeliveryStatus),
    validationStatus: strOrNull(r.validationStatus),
    validationNotes: strOrNull(r.validationNotes),
    validatedAt: strOrNull(r.validatedAt),
    validatedBy: strOrNull(r.validatedBy),
  };
}

export function normalizeRoutingDryRunDecisionList(
  items: RoutingDryRunDecisionItem[] | undefined | null
): RoutingDryRunDecisionItem[] {
  return safeNormalizeRoutingDryRunDecisionList(items).map(
    ({ rowPresentable: _rowPresentable, ...item }) => item
  );
}

/**
 * Coerce the on-demand `POST /admin/v1/routing/dry-run` result so the test panel
 * never crashes on a partial or unexpected API shape (e.g. missing
 * `lifecycleEventsEmitted`). Does not invent routing outcomes — only guarantees
 * render-safe field types.
 */
export function normalizeRoutingDryRunTestResult(raw: unknown): RoutingDryRunTestResult {
  const r = isRecord(raw) ? raw : {};
  const lifecycleEventsEmitted = Array.isArray(r.lifecycleEventsEmitted)
    ? r.lifecycleEventsEmitted.filter((x): x is string => typeof x === "string")
    : [];

  const result: RoutingDryRunTestResult = {
    matched: bool(r.matched),
    confidence: strOrEmpty(r.confidence, "unknown"),
    reason: strOrEmpty(r.reason, ""),
    deliveryMode: strOrEmpty(r.deliveryMode, "dry_run"),
    routingEventNameInternal: strOrEmpty(r.routingEventNameInternal, "routing_review_required"),
    decisionId: strOrEmpty(r.decisionId, ""),
    lifecycleEventsEmitted,
  };

  const matchType = strOrNull(r.matchType);
  if (matchType) result.matchType = matchType;
  const matchedRuleId = strOrNull(r.matchedRuleId);
  if (matchedRuleId) result.matchedRuleId = matchedRuleId;
  const destinationClientAccountId = strOrNull(r.destinationClientAccountId);
  if (destinationClientAccountId) result.destinationClientAccountId = destinationClientAccountId;
  const destinationSubaccountIdGhl = strOrNull(r.destinationSubaccountIdGhl);
  if (destinationSubaccountIdGhl) result.destinationSubaccountIdGhl = destinationSubaccountIdGhl;

  return result;
}

/** Per-row try/catch so one malformed API row cannot break the page. */
export function safeNormalizeRoutingDryRunDecisionList(
  items: unknown
): RoutingDryRunDecisionView[] {
  if (!Array.isArray(items)) return [];
  const out: RoutingDryRunDecisionView[] = [];
  for (const item of items) {
    try {
      if (item === null || item === undefined) {
        out.push(minimalUnavailableRow());
        continue;
      }
      const normalized = normalizeRoutingDryRunDecisionItem(
        item as RoutingDryRunDecisionItem | Record<string, unknown>
      );
      out.push({ ...normalized, rowPresentable: true });
    } catch {
      const id =
        item && typeof item === "object" && !Array.isArray(item) && "id" in item
          ? String((item as { id: unknown }).id)
          : undefined;
      out.push(minimalUnavailableRow(id));
    }
  }
  return out;
}
