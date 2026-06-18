import type { CampaignRoutingRule, RoutingDryRunDecision } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { RoutingAttributionInput } from "../lib/routing-attribution-extract.js";
import type { RoutingDryRunLeadIdentity } from "./routing-dry-run-admin.present.js";
import {
  type DeliveryPlanStatus,
  type DeliveryPlanStepStatus,
  type DeliveryPlanStepType,
} from "../lib/lead-delivery-plan-status.js";
import {
  DELIVERY_PLAN_DELIVERY_MODES,
  DELIVERY_PLAN_GENERATED_BY,
  DELIVERY_PLAN_TYPES,
  planPathLabel,
  planTypeFromDeliveryPlan,
  type DeliveryPlanType,
} from "../lib/lead-delivery-plan-types.js";
import { findRoutingDryRunDecisionById } from "../repositories/routing-dry-run-decision.repository.js";
import { prisma } from "../lib/db.js";
import {
  findDeliveryPlanByRoutingDecisionId,
  replaceDeliveryPlanForDecision,
} from "../repositories/lead-delivery-plan.repository.js";
import { getDuplicateRiskForRoutingDecision } from "./lead-identity/lead-identity-correlation.service.js";
import type { DuplicateRiskResult } from "./lead-identity/lead-identity.types.js";

export type DeliveryPlanStepDraft = {
  stepOrder: number;
  stepType: DeliveryPlanStepType;
  status: DeliveryPlanStepStatus;
  title: string;
  description?: string;
  targetSystem?: string;
  targetId?: string;
  requestPreviewJson?: Record<string, unknown>;
  resultPreviewJson?: Record<string, unknown>;
  warnings?: string[];
};

export type ManualDestinationPlanSource = {
  clientAccountId: string;
  clientDisplayName: string | null;
  nicheKey: string | null;
  productType: string | null;
  destinationSubaccountIdGhl: string;
  destinationPipelineIdGhl: string | null;
  destinationPipelineStageIdGhl: string | null;
  destinationWorkflowIdGhl: string | null;
  defaultAssignedUserIdGhl: string | null;
  opportunityCreationEnabled: boolean;
};

export type DeliveryPlanBuildContext = {
  decision: RoutingDryRunDecision;
  matched: boolean;
  rule: CampaignRoutingRule | null;
  attribution: RoutingAttributionInput;
  leadIdentity: RoutingDryRunLeadIdentity | null;
  duplicateRisk?: DuplicateRiskResult | null;
  routingAuthority?: "campaign_rule" | "manual_bulk_import";
  manualDestination?: ManualDestinationPlanSource | null;
};

function manualDestinationToPlanRule(
  manual: ManualDestinationPlanSource
): CampaignRoutingRule {
  return {
    id: "manual_bulk_import",
    masterClientAccountId: manual.clientAccountId,
    clientAccountId: manual.clientAccountId,
    clientDisplayName: manual.clientDisplayName,
    nicheKey: manual.nicheKey,
    productType: manual.productType,
    destinationSubaccountIdGhl: manual.destinationSubaccountIdGhl,
    destinationPipelineIdGhl: manual.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: manual.destinationPipelineStageIdGhl,
    destinationWorkflowIdGhl: manual.destinationWorkflowIdGhl,
    defaultAssignedUserIdGhl: manual.defaultAssignedUserIdGhl,
    opportunityCreationEnabled: manual.opportunityCreationEnabled,
    shadowDeliveryEnabled: false,
    deliveryEnabled: false,
    active: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as CampaignRoutingRule;
}

function trimOrNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function nicheTag(nicheKey: string | null | undefined): string | null {
  const n = trimOrNull(nicheKey);
  return n ? `SA360::NICHE::${n.toUpperCase()}` : null;
}

function sourceTag(sourcePlatform: string | null | undefined): string | null {
  const s = trimOrNull(sourcePlatform);
  return s ? `SA360::SOURCE::${s.toUpperCase()}` : null;
}

export function derivePlanStatusFromSteps(
  steps: DeliveryPlanStepDraft[],
  matched: boolean
): DeliveryPlanStatus {
  if (!matched) return "blocked";
  if (steps.some((s) => s.status === "blocked")) return "blocked";
  if (steps.some((s) => s.status === "needs_config")) return "needs_config";
  return "planned";
}

export function buildShadowDeliveryPlanSteps(
  ctx: DeliveryPlanBuildContext
): { steps: DeliveryPlanStepDraft[]; warnings: string[]; summary: string } {
  const warnings: string[] = [];

  if (!ctx.matched || !ctx.rule) {
    return {
      summary: "Routing did not match; shadow delivery plan is blocked.",
      warnings: ["No matched routing rule; delivery plan cannot be generated."],
      steps: [
        {
          stepOrder: 1,
          stepType: "mark_ready_for_delivery_review",
          status: "blocked",
          title: "Routing review required",
          description:
            "No active routing rule matched this lead. Resolve routing before generating a delivery plan.",
        },
      ],
    };
  }

  const rule = ctx.rule;
  const attr = ctx.attribution;
  const lead = ctx.leadIdentity;
  const subaccount = trimOrNull(ctx.decision.destinationSubaccountIdGhl) ?? "";
  const destClient =
    trimOrNull(ctx.decision.destinationClientAccountId) ?? rule.clientAccountId;

  if (!subaccount) {
    warnings.push("Destination GHL subaccount is not configured on the matched rule.");
  }
  if (!rule.shadowDeliveryEnabled) {
    warnings.push("shadowDeliveryEnabled is false on the matched routing rule.");
  }
  if (rule.deliveryEnabled) {
    warnings.push(
      "deliveryEnabled is true on the rule, but Phase 4D only records shadow plans — no external delivery runs."
    );
  }

  const normalized = {
    firstName: lead?.firstName ?? null,
    lastName: lead?.lastName ?? null,
    email: lead?.email ?? null,
    phoneE164: lead?.phoneE164 ?? null,
    leadUid: ctx.decision.sourceLeadUid,
    state: null as string | null,
  };

  const customFields: Record<string, string | null> = {
    sa360_lead_uid: ctx.decision.sourceLeadUid,
    sa360_client_account_id: destClient,
    sa360_niche_key: trimOrNull(rule.nicheKey ?? attr.nicheKey),
    sa360_niche_label: trimOrNull(rule.nicheKey ?? attr.nicheKey),
    sa360_source_platform: trimOrNull(attr.sourcePlatform),
    sa360_source_type: trimOrNull(attr.sourceType),
    sa360_campaign_id: trimOrNull(attr.campaignId),
    sa360_campaign_name: trimOrNull(attr.campaignName),
    sa360_adset_id: trimOrNull(attr.adsetId),
    sa360_ad_id: trimOrNull(attr.adId),
    sa360_utm_campaign: trimOrNull(attr.utmCampaign),
    sa360_utm_content: trimOrNull(attr.utmContent),
    sa360_lifecycle_stage: "NEW",
    sa360_routing_status: "ROUTED_SHADOW",
    sa360_backend_sync_status: "SHADOW_DELIVERY_PLANNED",
  };

  const tags = [
    nicheTag(rule.nicheKey ?? attr.nicheKey),
    sourceTag(attr.sourcePlatform),
    "SA360::EVENT::LEAD_CREATED",
  ].filter((t): t is string => Boolean(t));

  const steps: DeliveryPlanStepDraft[] = [];

  steps.push({
    stepOrder: 1,
    stepType: "normalize_lead",
    status: "planned",
    title: "Normalize lead identity",
    description: "Normalize phone, email, and name for downstream delivery.",
    requestPreviewJson: normalized,
  });

  steps.push({
    stepOrder: 2,
    stepType: "dedupe_check",
    status:
      ctx.duplicateRisk?.riskLevel === "likely_duplicate" ||
      ctx.duplicateRisk?.riskLevel === "source_duplicate"
        ? "blocked"
        : ctx.duplicateRisk?.riskLevel === "possible_duplicate"
          ? "needs_config"
          : ctx.duplicateRisk
            ? "planned"
            : "needs_config",
    title: "Dedupe check (identity correlation)",
    description:
      "Evaluates duplicate risk by phone, email, Meta lead id, and name/campaign proximity — no auto-merge.",
    requestPreviewJson: {
      keys: ["phoneE164", "email", "sourceLeadUid", "facebookLeadId"],
      phoneE164: normalized.phoneE164,
      email: normalized.email,
      sourceLeadUid: normalized.leadUid,
      facebookLeadId: ctx.duplicateRisk
        ? (ctx.attribution as { facebookLeadId?: string }).facebookLeadId ?? null
        : null,
      duplicateRisk: ctx.duplicateRisk
        ? {
            riskLevel: ctx.duplicateRisk.riskLevel,
            confidence: ctx.duplicateRisk.confidence,
            reasons: ctx.duplicateRisk.reasons,
            candidateMatchCount: ctx.duplicateRisk.candidateMatches.length,
            blocksLiveDelivery: ctx.duplicateRisk.blocksLiveDelivery,
          }
        : null,
    },
    resultPreviewJson: ctx.duplicateRisk
      ? {
          evaluated: true,
          riskLevel: ctx.duplicateRisk.riskLevel,
          recommendedAction: ctx.duplicateRisk.recommendedAction,
          candidateMatches: ctx.duplicateRisk.candidateMatches,
        }
      : { evaluated: false },
    warnings: ctx.duplicateRisk?.isWarningOnly
      ? ctx.duplicateRisk.reasons
      : ctx.duplicateRisk
        ? []
        : ["Duplicate-risk assessment not yet available — run routing dry-run first."],
  });

  if (ctx.duplicateRisk?.blocksLiveDelivery) {
    warnings.push(`Duplicate risk (${ctx.duplicateRisk.riskLevel}): ${ctx.duplicateRisk.recommendedAction}`);
  } else if (ctx.duplicateRisk?.isWarningOnly) {
    warnings.push(`Duplicate review recommended: ${ctx.duplicateRisk.recommendedAction}`);
  }

  steps.push({
    stepOrder: 3,
    stepType: "create_or_update_contact",
    status: subaccount ? "planned" : "needs_config",
    title: "Create or update GHL contact (shadow)",
    description: "Would upsert contact in destination subaccount — not executed in shadow mode.",
    targetSystem: "ghl",
    targetId: subaccount || undefined,
    requestPreviewJson: {
      locationId: subaccount,
      contact: {
        firstName: normalized.firstName,
        lastName: normalized.lastName,
        email: normalized.email,
        phone: normalized.phoneE164,
        source: attr.sourcePlatform ?? "sa360",
      },
    },
  });

  steps.push({
    stepOrder: 4,
    stepType: "stamp_custom_fields",
    status: "planned",
    title: "Stamp SA360 custom fields",
    description: "Would write SA360 routing and attribution fields on the contact.",
    targetSystem: "ghl",
    targetId: subaccount || undefined,
    requestPreviewJson: { customFields },
  });

  steps.push({
    stepOrder: 5,
    stepType: "add_tags",
    status: "planned",
    title: "Add SA360 tags",
    description: "Would apply niche/source/event tags on the contact.",
    targetSystem: "ghl",
    targetId: subaccount || undefined,
    requestPreviewJson: { tags },
  });

  const hasPipeline =
    Boolean(trimOrNull(rule.destinationPipelineIdGhl)) &&
    Boolean(trimOrNull(rule.destinationPipelineStageIdGhl));

  steps.push({
    stepOrder: 6,
    stepType: "create_or_update_opportunity",
    status: hasPipeline ? "planned" : "needs_config",
    title: "Create or update opportunity (shadow)",
    description: hasPipeline
      ? "Would create or update pipeline opportunity for this lead."
      : "Pipeline and stage are not configured on the routing rule.",
    targetSystem: "ghl",
    targetId: subaccount || undefined,
    requestPreviewJson: hasPipeline
      ? {
          pipelineId: rule.destinationPipelineIdGhl,
          pipelineStageId: rule.destinationPipelineStageIdGhl,
          contactId: lead?.contactIdGhl,
        }
      : undefined,
    warnings: hasPipeline ? undefined : ["Configure destinationPipelineIdGhl and destinationPipelineStageIdGhl on the rule."],
  });

  const assignedUser = trimOrNull(rule.defaultAssignedUserIdGhl);
  steps.push({
    stepOrder: 7,
    stepType: "assign_owner",
    status: assignedUser ? "planned" : "needs_config",
    title: "Assign owner (shadow)",
    description: assignedUser
      ? "Would assign the configured default GHL user to the contact."
      : "No defaultAssignedUserIdGhl configured on the routing rule.",
    targetSystem: "ghl",
    targetId: assignedUser ?? undefined,
    requestPreviewJson: assignedUser ? { assignedTo: assignedUser } : undefined,
  });

  const workflowId = trimOrNull(rule.destinationWorkflowIdGhl);
  steps.push({
    stepOrder: 8,
    stepType: "start_workflow",
    status: workflowId ? "planned" : "needs_config",
    title: "Start intake workflow (shadow)",
    description: workflowId
      ? "Would enroll contact in the configured GHL workflow."
      : "No destinationWorkflowIdGhl configured on the routing rule.",
    targetSystem: "ghl",
    targetId: workflowId ?? subaccount ?? undefined,
    requestPreviewJson: workflowId
      ? { workflowId, locationId: subaccount }
      : undefined,
    warnings: workflowId ? undefined : ["Configure destinationWorkflowIdGhl on the routing rule."],
  });

  if (!rule.backupSheetEnabled) {
    steps.push({
      stepOrder: 9,
      stepType: "write_backup_sheet",
      status: "skipped",
      title: "Backup sheet row",
      description: "Backup sheet is disabled for this routing rule.",
      targetSystem: "google_sheets",
    });
  } else {
    const sheetId = trimOrNull(rule.backupSheetId);
    steps.push({
      stepOrder: 9,
      stepType: "write_backup_sheet",
      status: sheetId ? "planned" : "needs_config",
      title: "Backup sheet row (shadow)",
      description: sheetId
        ? "Would append a backup row to the configured sheet."
        : "backupSheetEnabled is true but backupSheetId is missing.",
      targetSystem: "google_sheets",
      targetId: sheetId ?? undefined,
      requestPreviewJson: sheetId ? { spreadsheetId: sheetId, leadUid: ctx.decision.sourceLeadUid } : undefined,
    });
  }

  steps.push({
    stepOrder: 10,
    stepType: "emit_lifecycle_event",
    status: "planned",
    title: "Emit internal lifecycle event",
    description: "Would record lead_delivery_planned (shadow) — no Meta or external dispatch.",
    targetSystem: "sa360",
    requestPreviewJson: {
      event_name_internal: "lead_delivery_planned",
      delivery_mode: "shadow",
      routing_decision_id: ctx.decision.id,
    },
  });

  const displayName = trimOrNull(rule.clientDisplayName) ?? destClient;
  const summary = `Shadow delivery plan for ${displayName} (${subaccount || "no subaccount"}): ${steps.length} steps, no external actions executed.`;

  return { steps, warnings, summary };
}

/** Steps whose needs_config/blocked status blocks direct canary adapter simulation. */
export const DIRECT_CANARY_BLOCKING_STEP_TYPES = new Set<DeliveryPlanStepType>([
  "dedupe_check",
  "create_or_update_contact",
  "create_or_update_opportunity",
]);

export function deriveDirectCanaryPlanStatusFromSteps(
  steps: DeliveryPlanStepDraft[],
  matched: boolean
): DeliveryPlanStatus {
  if (!matched) return "blocked";
  if (steps.some((s) => s.status === "blocked")) return "blocked";
  const configGap = steps.some(
    (s) =>
      DIRECT_CANARY_BLOCKING_STEP_TYPES.has(s.stepType) && s.status === "needs_config"
  );
  if (configGap) return "needs_config";
  return "planned";
}

export type DirectCanaryPlanDiagnostics = {
  planType: DeliveryPlanType;
  planPath: "adapter_plan" | "shadow_plan";
  planStatus: string;
  missingConfigFields: string[];
  stepIssues: Array<{ stepType: string; status: string; title: string; detail?: string }>;
};

export function collectDirectCanaryPlanDiagnostics(plan: {
  status: string;
  deliveryMode: string;
  generatedBy: string;
  steps?: Array<{
    stepType: string;
    status: string;
    title: string;
    warnings?: unknown;
  }>;
}): DirectCanaryPlanDiagnostics {
  const planType = planTypeFromDeliveryPlan(plan);
  const stepIssues = (plan.steps ?? [])
    .filter(
      (s) =>
        (s.status === "needs_config" || s.status === "blocked") &&
        DIRECT_CANARY_BLOCKING_STEP_TYPES.has(s.stepType as DeliveryPlanStepType)
    )
    .map((s) => ({
      stepType: s.stepType,
      status: s.status,
      title: s.title,
      detail: Array.isArray(s.warnings)
        ? s.warnings.filter((w): w is string => typeof w === "string").join("; ")
        : undefined,
    }));

  const missingConfigFields: string[] = [];
  for (const issue of stepIssues) {
    if (issue.stepType === "create_or_update_contact") {
      missingConfigFields.push("destinationSubaccountIdGhl");
    }
    if (issue.stepType === "create_or_update_opportunity") {
      missingConfigFields.push("destinationPipelineIdGhl", "destinationPipelineStageIdGhl");
    }
    if (issue.stepType === "dedupe_check" && issue.status === "blocked") {
      missingConfigFields.push("duplicateRisk");
    }
  }

  return {
    planType,
    planPath: planPathLabel(planType),
    planStatus: plan.status,
    missingConfigFields: [...new Set(missingConfigFields)],
    stepIssues,
  };
}

export function formatDirectCanaryPlanBlockers(
  diagnostics: DirectCanaryPlanDiagnostics,
  matchedRuleSummary?: {
    id: string;
    matchType: string;
    matchValue: string | null;
    clientAccountId: string;
    destinationSubaccountIdGhl: string;
  } | null
): string[] {
  const blockers: string[] = [];
  if (matchedRuleSummary) {
    blockers.push(
      `Matched rule ${matchedRuleSummary.id} (${matchedRuleSummary.matchType}${
        matchedRuleSummary.matchValue ? `: ${matchedRuleSummary.matchValue}` : ""
      }) → ${matchedRuleSummary.clientAccountId} / ${matchedRuleSummary.destinationSubaccountIdGhl}`
    );
  }
  blockers.push(
    `Plan type: ${diagnostics.planType} (${diagnostics.planPath}, status: ${diagnostics.planStatus})`
  );
  if (diagnostics.missingConfigFields.length > 0) {
    blockers.push(`Missing adapter config: ${diagnostics.missingConfigFields.join(", ")}`);
  }
  for (const issue of diagnostics.stepIssues) {
    blockers.push(
      `${issue.stepType} (${issue.status}): ${issue.title}${
        issue.detail ? ` — ${issue.detail}` : ""
      }`
    );
  }
  if (diagnostics.stepIssues.length === 0 && diagnostics.planStatus === "needs_config") {
    blockers.push("Adapter plan needs_config — review plan steps in Admin C.O.C.");
  }
  return blockers;
}

export function buildDirectCanaryDeliveryPlanSteps(
  ctx: DeliveryPlanBuildContext
): { steps: DeliveryPlanStepDraft[]; warnings: string[]; summary: string } {
  const warnings: string[] = [];

  const effectiveRule =
    ctx.rule ??
    (ctx.routingAuthority === "manual_bulk_import" && ctx.manualDestination
      ? manualDestinationToPlanRule(ctx.manualDestination)
      : null);

  if (!ctx.matched || !effectiveRule) {
    return {
      summary: "Routing did not match; direct canary delivery plan is blocked.",
      warnings: ["No matched routing rule; adapter plan cannot be generated."],
      steps: [
        {
          stepOrder: 1,
          stepType: "mark_ready_for_delivery_review",
          status: "blocked",
          title: "Routing review required",
          description:
            ctx.routingAuthority === "manual_bulk_import"
              ? "Bulk import destination metadata is missing; resolve destination before simulation."
              : "No active routing rule matched this lead. Resolve routing before direct canary delivery.",
        },
      ],
    };
  }

  const rule = effectiveRule;
  const attr = ctx.attribution;
  const lead = ctx.leadIdentity;
  const subaccount = trimOrNull(ctx.decision.destinationSubaccountIdGhl) ?? "";
  const destClient =
    trimOrNull(ctx.decision.destinationClientAccountId) ?? rule.clientAccountId;

  if (!subaccount) {
    warnings.push("Destination GHL subaccount is not configured on the matched rule.");
  }

  const normalized = {
    firstName: lead?.firstName ?? null,
    lastName: lead?.lastName ?? null,
    email: lead?.email ?? null,
    phoneE164: lead?.phoneE164 ?? null,
    leadUid: ctx.decision.sourceLeadUid,
    state: null as string | null,
  };

  const customFields: Record<string, string | null> = {
    sa360_lead_uid: ctx.decision.sourceLeadUid,
    sa360_client_account_id: destClient,
    sa360_niche_key: trimOrNull(rule.nicheKey ?? attr.nicheKey),
    sa360_source_platform: trimOrNull(attr.sourcePlatform),
    sa360_campaign_id: trimOrNull(attr.campaignId),
    sa360_utm_campaign: trimOrNull(attr.utmCampaign),
    sa360_lifecycle_stage: "NEW",
    sa360_routing_status: "ROUTED_DIRECT_CANARY",
    sa360_backend_sync_status: "DIRECT_CANARY_PLANNED",
  };

  const tags = [
    nicheTag(rule.nicheKey ?? attr.nicheKey),
    sourceTag(attr.sourcePlatform),
    "SA360::EVENT::LEAD_CREATED",
  ].filter((t): t is string => Boolean(t));

  const steps: DeliveryPlanStepDraft[] = [];

  steps.push({
    stepOrder: 1,
    stepType: "normalize_lead",
    status: "planned",
    title: "Normalize lead identity",
    description: "Normalize phone, email, and name for GHL adapter delivery.",
    requestPreviewJson: normalized,
  });

  steps.push({
    stepOrder: 2,
    stepType: "dedupe_check",
    status: ctx.duplicateRisk?.blocksLiveDelivery
      ? "blocked"
      : ctx.duplicateRisk
        ? "planned"
        : "planned",
    title: "Dedupe check (identity correlation)",
    description:
      "Evaluates duplicate risk before live canary; simulation may proceed with warnings.",
    requestPreviewJson: {
      duplicateRisk: ctx.duplicateRisk
        ? {
            riskLevel: ctx.duplicateRisk.riskLevel,
            blocksLiveDelivery: ctx.duplicateRisk.blocksLiveDelivery,
          }
        : null,
    },
    warnings: ctx.duplicateRisk?.isWarningOnly ? ctx.duplicateRisk.reasons : undefined,
  });

  if (ctx.duplicateRisk?.blocksLiveDelivery) {
    warnings.push(
      `Duplicate risk (${ctx.duplicateRisk.riskLevel}): ${ctx.duplicateRisk.recommendedAction}`
    );
  }

  steps.push({
    stepOrder: 3,
    stepType: "create_or_update_contact",
    status: subaccount ? "planned" : "needs_config",
    title: "Create or update GHL contact",
    description: "Adapter will upsert contact in destination subaccount.",
    targetSystem: "ghl",
    targetId: subaccount || undefined,
    requestPreviewJson: {
      locationId: subaccount,
      contact: {
        firstName: normalized.firstName,
        lastName: normalized.lastName,
        email: normalized.email,
        phone: normalized.phoneE164,
      },
    },
    warnings: subaccount ? undefined : ["Configure destinationSubaccountIdGhl on the routing rule."],
  });

  steps.push({
    stepOrder: 4,
    stepType: "stamp_custom_fields",
    status: "planned",
    title: "Stamp SA360 custom fields",
    description: "Adapter stamps logical SA360 fields when mapping is configured.",
    targetSystem: "ghl",
    targetId: subaccount || undefined,
    requestPreviewJson: { customFields },
  });

  steps.push({
    stepOrder: 5,
    stepType: "add_tags",
    status: "planned",
    title: "Add SA360 tags",
    targetSystem: "ghl",
    targetId: subaccount || undefined,
    requestPreviewJson: { tags },
  });

  const hasPipeline =
    Boolean(trimOrNull(rule.destinationPipelineIdGhl)) &&
    Boolean(trimOrNull(rule.destinationPipelineStageIdGhl));

  steps.push({
    stepOrder: 6,
    stepType: "create_or_update_opportunity",
    status:
      rule.opportunityCreationEnabled === false
        ? "skipped"
        : hasPipeline
          ? "planned"
          : "needs_config",
    title: "Create or update opportunity",
    description: hasPipeline
      ? "Adapter will create pipeline opportunity for this lead."
      : "Pipeline and stage are required for direct canary opportunity step.",
    targetSystem: "ghl",
    targetId: subaccount || undefined,
    requestPreviewJson: hasPipeline
      ? {
          pipelineId: rule.destinationPipelineIdGhl,
          pipelineStageId: rule.destinationPipelineStageIdGhl,
        }
      : undefined,
    warnings: hasPipeline
      ? undefined
      : ["Configure destinationPipelineIdGhl and destinationPipelineStageIdGhl on the rule."],
  });

  const assignedUser = trimOrNull(rule.defaultAssignedUserIdGhl);
  steps.push({
    stepOrder: 7,
    stepType: "assign_owner",
    status: assignedUser ? "planned" : "skipped",
    title: "Assign owner (optional)",
    description: assignedUser
      ? "Live canary may assign owner when configured."
      : "Optional — skipped when defaultAssignedUserIdGhl is not set.",
    targetSystem: "ghl",
    targetId: assignedUser ?? undefined,
    requestPreviewJson: assignedUser ? { assignedTo: assignedUser } : undefined,
  });

  const workflowId = trimOrNull(rule.destinationWorkflowIdGhl);
  steps.push({
    stepOrder: 8,
    stepType: "start_workflow",
    status: workflowId ? "planned" : "skipped",
    title: "Start workflow (optional)",
    description: workflowId
      ? "Live canary may enroll contact when configured."
      : "Optional — skipped when destinationWorkflowIdGhl is not set.",
    targetSystem: "ghl",
    targetId: workflowId ?? subaccount ?? undefined,
    requestPreviewJson: workflowId ? { workflowId, locationId: subaccount } : undefined,
  });

  steps.push({
    stepOrder: 9,
    stepType: "write_backup_sheet",
    status: "skipped",
    title: "Backup sheet",
    description: "Not used on direct canary adapter path.",
    targetSystem: "google_sheets",
  });

  steps.push({
    stepOrder: 10,
    stepType: "emit_lifecycle_event",
    status: "planned",
    title: "Record direct canary plan",
    description: "Internal plan for guarded adapter simulation / one-lead live canary.",
    targetSystem: "sa360",
    requestPreviewJson: {
      event_name_internal: "lead_delivery_planned",
      delivery_mode: DELIVERY_PLAN_DELIVERY_MODES.DIRECT_CANARY,
      plan_type: DELIVERY_PLAN_TYPES.ADAPTER_SIMULATION,
      routing_decision_id: ctx.decision.id,
    },
  });

  const displayName = trimOrNull(rule.clientDisplayName) ?? destClient;
  const summary = `Direct canary adapter plan for ${displayName} (${subaccount || "no subaccount"}): ${steps.length} steps for guarded simulation/live canary.`;

  return { steps, warnings, summary };
}

function stepsToCreateInput(
  steps: DeliveryPlanStepDraft[]
): Prisma.LeadDeliveryPlanStepCreateWithoutDeliveryPlanInput[] {
  return steps.map((s) => {
    const row: Prisma.LeadDeliveryPlanStepCreateWithoutDeliveryPlanInput = {
      stepOrder: s.stepOrder,
      stepType: s.stepType,
      status: s.status,
      title: s.title,
      description: s.description ?? null,
      targetSystem: s.targetSystem ?? null,
      targetId: s.targetId ?? null,
    };
    if (s.requestPreviewJson) {
      row.requestPreviewJson = s.requestPreviewJson as Prisma.InputJsonValue;
    }
    if (s.resultPreviewJson) {
      row.resultPreviewJson = s.resultPreviewJson as Prisma.InputJsonValue;
    }
    if (s.warnings && s.warnings.length > 0) {
      row.warnings = s.warnings;
    }
    return row;
  });
}

export async function generateLeadDeliveryPlanForDecision(
  routingDryRunDecisionId: string,
  opts: {
    leadIdentity?: RoutingDryRunLeadIdentity | null;
    attribution?: RoutingAttributionInput;
  } = {}
): Promise<
  | { plan: Awaited<ReturnType<typeof replaceDeliveryPlanForDecision>> }
  | { notFound: true }
> {
  const decision = await findRoutingDryRunDecisionById(routingDryRunDecisionId.trim());
  if (!decision) return { notFound: true };

  const attribution =
    opts.attribution ??
    (decision.attributionSnapshot as RoutingAttributionInput | null) ??
    ({
      masterClientAccountId: decision.masterClientAccountId,
    } as RoutingAttributionInput);

  const rule =
    decision.matched && decision.matchedRuleId
      ? await prisma.campaignRoutingRule.findUnique({ where: { id: decision.matchedRuleId } })
      : null;

  const duplicateRiskAssessment = await getDuplicateRiskForRoutingDecision(decision.id);
  const duplicateRisk = duplicateRiskAssessment
    ? {
        riskLevel: duplicateRiskAssessment.riskLevel,
        confidence: duplicateRiskAssessment.confidence,
        reasons: duplicateRiskAssessment.reasons,
        candidateMatches: duplicateRiskAssessment.candidateMatches,
        recommendedAction: duplicateRiskAssessment.recommendedAction,
        identityStatus: duplicateRiskAssessment.identityStatus,
        blocksLiveDelivery: duplicateRiskAssessment.blocksLiveDelivery,
        isWarningOnly: duplicateRiskAssessment.isWarningOnly,
      }
    : null;

  const { steps, warnings, summary } = buildShadowDeliveryPlanSteps({
    decision,
    matched: decision.matched,
    rule,
    attribution,
    leadIdentity: opts.leadIdentity ?? null,
    duplicateRisk,
  });

  const planStatus = derivePlanStatusFromSteps(steps, decision.matched);

  const plan = await replaceDeliveryPlanForDecision(decision.id, {
    routingDryRunDecision: { connect: { id: decision.id } },
    lifecycleEventId: decision.sourceEventUuid,
    masterClientAccountId: decision.masterClientAccountId,
    sourceLeadUid: decision.sourceLeadUid,
    sourceContactIdGhl: opts.leadIdentity?.contactIdGhl ?? null,
    sourcePhoneE164: opts.leadIdentity?.phoneE164 ?? null,
    sourceEmail: opts.leadIdentity?.email ?? null,
    destinationClientAccountId:
      decision.destinationClientAccountId ?? rule?.clientAccountId ?? "unknown",
    destinationSubaccountIdGhl: decision.destinationSubaccountIdGhl ?? "",
    destinationClientDisplayName: rule?.clientDisplayName ?? null,
    nicheKey: rule?.nicheKey ?? attribution.nicheKey ?? null,
    productType: rule?.productType ?? attribution.productType ?? null,
    deliveryMode: "shadow",
    status: planStatus,
    planVersion: "1.0",
    generatedBy: "sa360_shadow_delivery",
    summary,
    warnings: warnings.length > 0 ? warnings : undefined,
    steps: { create: stepsToCreateInput(steps) },
  });

  return { plan };
}

export async function generateDirectCanaryDeliveryPlanForDecision(
  routingDryRunDecisionId: string,
  opts: {
    leadIdentity?: RoutingDryRunLeadIdentity | null;
    attribution?: RoutingAttributionInput;
  } = {}
): Promise<
  | { plan: Awaited<ReturnType<typeof replaceDeliveryPlanForDecision>> }
  | { notFound: true }
> {
  const decision = await findRoutingDryRunDecisionById(routingDryRunDecisionId.trim());
  if (!decision) return { notFound: true };

  const attribution =
    opts.attribution ??
    (decision.attributionSnapshot as RoutingAttributionInput | null) ??
    ({
      masterClientAccountId: decision.masterClientAccountId,
    } as RoutingAttributionInput);

  const rule =
    decision.matched && decision.matchedRuleId
      ? await prisma.campaignRoutingRule.findUnique({ where: { id: decision.matchedRuleId } })
      : null;

  const duplicateRiskAssessment = await getDuplicateRiskForRoutingDecision(decision.id);
  const duplicateRisk = duplicateRiskAssessment
    ? {
        riskLevel: duplicateRiskAssessment.riskLevel,
        confidence: duplicateRiskAssessment.confidence,
        reasons: duplicateRiskAssessment.reasons,
        candidateMatches: duplicateRiskAssessment.candidateMatches,
        recommendedAction: duplicateRiskAssessment.recommendedAction,
        identityStatus: duplicateRiskAssessment.identityStatus,
        blocksLiveDelivery: duplicateRiskAssessment.blocksLiveDelivery,
        isWarningOnly: duplicateRiskAssessment.isWarningOnly,
      }
    : null;

  const { steps, warnings, summary } = buildDirectCanaryDeliveryPlanSteps({
    decision,
    matched: decision.matched,
    rule,
    attribution,
    leadIdentity: opts.leadIdentity ?? null,
    duplicateRisk,
  });

  const planStatus = deriveDirectCanaryPlanStatusFromSteps(steps, decision.matched);

  const plan = await replaceDeliveryPlanForDecision(decision.id, {
    routingDryRunDecision: { connect: { id: decision.id } },
    lifecycleEventId: decision.sourceEventUuid,
    masterClientAccountId: decision.masterClientAccountId,
    sourceLeadUid: decision.sourceLeadUid,
    sourceContactIdGhl: opts.leadIdentity?.contactIdGhl ?? null,
    sourcePhoneE164: opts.leadIdentity?.phoneE164 ?? null,
    sourceEmail: opts.leadIdentity?.email ?? null,
    destinationClientAccountId:
      decision.destinationClientAccountId ?? rule?.clientAccountId ?? "unknown",
    destinationSubaccountIdGhl: decision.destinationSubaccountIdGhl ?? "",
    destinationClientDisplayName: rule?.clientDisplayName ?? null,
    nicheKey: rule?.nicheKey ?? attribution.nicheKey ?? null,
    productType: rule?.productType ?? attribution.productType ?? null,
    deliveryMode: DELIVERY_PLAN_DELIVERY_MODES.DIRECT_CANARY,
    status: planStatus,
    planVersion: "2.0-direct-canary",
    generatedBy: DELIVERY_PLAN_GENERATED_BY.DIRECT_CANARY,
    summary,
    warnings: warnings.length > 0 ? warnings : undefined,
    steps: { create: stepsToCreateInput(steps) },
  });

  return { plan };
}

export async function generateManualBulkImportDeliveryPlanForDecision(
  routingDryRunDecisionId: string,
  manualDestination: ManualDestinationPlanSource,
  opts: {
    leadIdentity?: RoutingDryRunLeadIdentity | null;
    attribution?: RoutingAttributionInput;
  } = {}
): Promise<
  | { plan: Awaited<ReturnType<typeof replaceDeliveryPlanForDecision>> }
  | { notFound: true }
> {
  const decision = await findRoutingDryRunDecisionById(routingDryRunDecisionId.trim());
  if (!decision) return { notFound: true };

  const attribution =
    opts.attribution ??
    (decision.attributionSnapshot as RoutingAttributionInput | null) ??
    ({
      masterClientAccountId: decision.masterClientAccountId,
      nicheKey: manualDestination.nicheKey ?? undefined,
      productType: manualDestination.productType ?? undefined,
    } as RoutingAttributionInput);

  const duplicateRiskAssessment = await getDuplicateRiskForRoutingDecision(decision.id);
  const duplicateRisk = duplicateRiskAssessment
    ? {
        riskLevel: duplicateRiskAssessment.riskLevel,
        confidence: duplicateRiskAssessment.confidence,
        reasons: duplicateRiskAssessment.reasons,
        candidateMatches: duplicateRiskAssessment.candidateMatches,
        recommendedAction: duplicateRiskAssessment.recommendedAction,
        identityStatus: duplicateRiskAssessment.identityStatus,
        blocksLiveDelivery: duplicateRiskAssessment.blocksLiveDelivery,
        isWarningOnly: duplicateRiskAssessment.isWarningOnly,
      }
    : null;

  const { steps, warnings, summary } = buildDirectCanaryDeliveryPlanSteps({
    decision,
    matched: decision.matched,
    rule: null,
    routingAuthority: "manual_bulk_import",
    manualDestination,
    attribution,
    leadIdentity: opts.leadIdentity ?? null,
    duplicateRisk,
  });

  const planStatus = deriveDirectCanaryPlanStatusFromSteps(steps, decision.matched);

  const plan = await replaceDeliveryPlanForDecision(decision.id, {
    routingDryRunDecision: { connect: { id: decision.id } },
    lifecycleEventId: decision.sourceEventUuid,
    masterClientAccountId: decision.masterClientAccountId,
    sourceLeadUid: decision.sourceLeadUid,
    sourceContactIdGhl: opts.leadIdentity?.contactIdGhl ?? null,
    sourcePhoneE164: opts.leadIdentity?.phoneE164 ?? null,
    sourceEmail: opts.leadIdentity?.email ?? null,
    destinationClientAccountId: manualDestination.clientAccountId,
    destinationSubaccountIdGhl: manualDestination.destinationSubaccountIdGhl,
    destinationClientDisplayName: manualDestination.clientDisplayName,
    nicheKey: manualDestination.nicheKey ?? attribution.nicheKey ?? null,
    productType: manualDestination.productType ?? attribution.productType ?? null,
    deliveryMode: DELIVERY_PLAN_DELIVERY_MODES.DIRECT_CANARY,
    status: planStatus,
    planVersion: "2.0-manual-bulk-import",
    generatedBy: DELIVERY_PLAN_GENERATED_BY.DIRECT_CANARY,
    summary,
    warnings: warnings.length > 0 ? warnings : undefined,
    steps: { create: stepsToCreateInput(steps) },
  });

  return { plan };
}

export async function getExistingDeliveryPlanForDecision(routingDryRunDecisionId: string) {
  return findDeliveryPlanByRoutingDecisionId(routingDryRunDecisionId.trim());
}
