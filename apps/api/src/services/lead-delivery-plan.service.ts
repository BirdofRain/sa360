import type { CampaignRoutingRule, RoutingDryRunDecision } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { RoutingAttributionInput } from "../lib/routing-attribution-extract.js";
import type { RoutingDryRunLeadIdentity } from "./routing-dry-run-admin.present.js";
import {
  type DeliveryPlanStatus,
  type DeliveryPlanStepStatus,
  type DeliveryPlanStepType,
} from "../lib/lead-delivery-plan-status.js";
import { findRoutingDryRunDecisionById } from "../repositories/routing-dry-run-decision.repository.js";
import { prisma } from "../lib/db.js";
import {
  findDeliveryPlanByRoutingDecisionId,
  replaceDeliveryPlanForDecision,
} from "../repositories/lead-delivery-plan.repository.js";

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

export type DeliveryPlanBuildContext = {
  decision: RoutingDryRunDecision;
  matched: boolean;
  rule: CampaignRoutingRule | null;
  attribution: RoutingAttributionInput;
  leadIdentity: RoutingDryRunLeadIdentity | null;
};

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
    status: "needs_config",
    title: "Dedupe check (preview)",
    description:
      "Would check duplicates by phone, email, lead UID, and Meta lead id when configured.",
    requestPreviewJson: {
      keys: ["phoneE164", "email", "sourceLeadUid", "facebookLeadId"],
      phoneE164: normalized.phoneE164,
      email: normalized.email,
      sourceLeadUid: normalized.leadUid,
    },
    warnings: ["Automated dedupe rules are not fully configured in SA360 yet."],
  });

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

  const { steps, warnings, summary } = buildShadowDeliveryPlanSteps({
    decision,
    matched: decision.matched,
    rule,
    attribution,
    leadIdentity: opts.leadIdentity ?? null,
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

export async function getExistingDeliveryPlanForDecision(routingDryRunDecisionId: string) {
  return findDeliveryPlanByRoutingDecisionId(routingDryRunDecisionId.trim());
}
