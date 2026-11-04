import type { CampaignRoutingRule, GhlDeliveryAdapterRun, GhlDeliveryAdapterStepRun } from "@prisma/client";
import {
  adapterSimulationRecordMode,
  getGhlDeliveryAdapterMode,
  GHL_LIVE_NOT_IMPLEMENTED,
  type GhlAdapterMode,
} from "../../lib/ghl-delivery-adapter-mode.js";
import { resolveDeliveryPlanRule } from "../association-ghl-delivery-source.js";
import { findDeliveryPlanById } from "../../repositories/lead-delivery-plan.repository.js";
import { findRoutingDryRunDecisionById } from "../../repositories/routing-dry-run-decision.repository.js";
import {
  buildAssignOwnerRequest,
  buildBackupSheetPreview,
  buildContactUpsertRequest,
  buildCustomFieldStampRequest,
  buildOpportunityRequest,
  buildTagRequest,
  buildWorkflowStartRequest,
  planContactNamesFromContext,
  validateDeliveryPlanForGhlSimulation,
} from "./ghl-delivery-request-builders.js";
import { loadRecordedDeliveryPreviewContext } from "./ghl-live-canary.service.js";
import { knownWritePlanBlocksAutomationEntry } from "./routing-tag-plan.js";
import { planRoutingTagPreview } from "./vet-ghl-delivery-contract.js";
import { presentVetWritePlan } from "./vet-ghl-write-plan.present.js";
import type {
  GhlAdapterPlanContext,
  GhlAdapterSimulationResult,
  GhlAdapterStepDraft,
} from "./ghl-delivery-adapter.types.js";
import { probeGhlLocationReadonly } from "./ghl-delivery-readonly-probe.js";
import { assertLiveDeliveryAllowed } from "../delivery-guard.js";
import { ruleToReadinessInput } from "../delivery-readiness-admin.present.js";
import { getDuplicateRiskForRoutingDecision } from "../lead-identity/lead-identity-correlation.service.js";

const GHL_STEP_TYPES = new Set([
  "create_or_update_contact",
  "stamp_custom_fields",
  "add_tags",
  "create_or_update_opportunity",
  "assign_owner",
  "start_workflow",
  "write_backup_sheet",
]);

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function buildStepDrafts(
  ctx: GhlAdapterPlanContext,
  mode: GhlAdapterMode,
  validation: ReturnType<typeof validateDeliveryPlanForGhlSimulation>
): GhlAdapterStepDraft[] {
  const drafts: GhlAdapterStepDraft[] = [];
  const contact = buildContactUpsertRequest(ctx);
  const fields = buildCustomFieldStampRequest(ctx);
  const tagRequest = buildTagRequest(ctx);
  const tags = planRoutingTagPreview({
    locationId: tagRequest.locationId,
    tags: tagRequest.tags,
    blockAutomationEntry: knownWritePlanBlocksAutomationEntry(ctx),
  });
  const opportunity = buildOpportunityRequest(ctx);
  const owner = buildAssignOwnerRequest(ctx);
  const workflow = buildWorkflowStartRequest(ctx);
  const sheet = buildBackupSheetPreview(ctx);

  const oppValidation = opportunity
    ? { errors: [] as string[], warnings: [] as string[] }
    : { errors: ["Pipeline/stage not configured."], warnings: [] as string[] };
  const wfValidation = workflow
    ? { errors: [] as string[], warnings: [] as string[] }
    : { errors: ["Workflow ID not configured."], warnings: [] as string[] };

  for (const planStep of ctx.plan.steps) {
    if (planStep.stepType === "dedupe_check") {
      const preview = asRecord(planStep.requestPreviewJson);
      const result = asRecord(planStep.resultPreviewJson);
      const dup = asRecord(preview?.duplicateRisk);
      const riskLevel = typeof dup?.riskLevel === "string" ? dup.riskLevel : "none";
      const blocks = dup?.blocksLiveDelivery === true;
      drafts.push({
        deliveryPlanStepId: planStep.id,
        stepOrder: planStep.stepOrder,
        stepType: planStep.stepType,
        targetSystem: "sa360",
        targetId: null,
        mode,
        status: blocks ? "failed_validation" : riskLevel === "possible_duplicate" ? "simulated" : "simulated",
        title: planStep.title,
        requestPreviewJson: preview ?? null,
        responsePreviewJson: {
          simulated: true,
          externalCallExecuted: false,
          duplicateRiskLevel: riskLevel,
          evaluated: result?.evaluated === true,
          note: "Dedupe check is internal SA360 correlation only — no GHL contact lookup or merge.",
        },
        validationErrors: blocks
          ? [`Duplicate risk (${riskLevel}) blocks live delivery path.`]
          : [],
        warnings:
          riskLevel === "possible_duplicate"
            ? ["Possible duplicate — operator review recommended before live cutover."]
            : [],
      });
      continue;
    }

    if (planStep.stepType === "normalize_lead") {
      drafts.push({
        deliveryPlanStepId: planStep.id,
        stepOrder: planStep.stepOrder,
        stepType: planStep.stepType,
        targetSystem: "sa360",
        targetId: null,
        mode,
        status: "simulated",
        title: planStep.title,
        requestPreviewJson: asRecord(planStep.requestPreviewJson) ?? null,
        responsePreviewJson: {
          simulated: true,
          externalCallExecuted: false,
          note: "Lead normalization preview only.",
        },
        validationErrors: [],
        warnings: [],
      });
      continue;
    }

    if (!GHL_STEP_TYPES.has(planStep.stepType) && planStep.targetSystem !== "google_sheets") {
      drafts.push({
        deliveryPlanStepId: planStep.id,
        stepOrder: planStep.stepOrder,
        stepType: planStep.stepType,
        targetSystem: planStep.targetSystem ?? "sa360",
        targetId: planStep.targetId,
        mode,
        status: "skipped",
        title: planStep.title,
        requestPreviewJson: asRecord(planStep.requestPreviewJson),
        responsePreviewJson: { simulated: false, reason: "Non-GHL step skipped in adapter test." },
        validationErrors: [],
        warnings: [],
      });
      continue;
    }

    let request: Record<string, unknown> | null = asRecord(planStep.requestPreviewJson);
    let stepErrors: string[] = [];
    let stepWarnings: string[] = planStep.warnings
      ? (Array.isArray(planStep.warnings)
          ? (planStep.warnings as string[])
          : [])
      : [];

    switch (planStep.stepType) {
      case "create_or_update_contact":
        request = {
          ...(contact as unknown as Record<string, unknown>),
          vetWritePlan: vetWritePlanForContext(ctx),
        };
        stepErrors = validation.errors.filter((e) => e.includes("subaccount") || e.includes("lead_uid"));
        break;
      case "stamp_custom_fields":
        request = fields as unknown as Record<string, unknown>;
        break;
      case "add_tags":
        request = tags as unknown as Record<string, unknown>;
        stepWarnings = [...stepWarnings, tags.detail];
        break;
      case "create_or_update_opportunity":
        request = opportunity ? (opportunity as unknown as Record<string, unknown>) : request;
        stepErrors = oppValidation.errors;
        break;
      case "assign_owner":
        request = owner ? (owner as unknown as Record<string, unknown>) : null;
        if (!owner) stepWarnings = [...stepWarnings, "defaultAssignedUserIdGhl not configured."];
        break;
      case "start_workflow":
        request = workflow ? (workflow as unknown as Record<string, unknown>) : request;
        stepErrors = wfValidation.errors;
        break;
      case "write_backup_sheet":
        request = sheet as unknown as Record<string, unknown>;
        if (ctx.rule?.backupSheetEnabled && !ctx.rule.backupSheetId) {
          stepErrors = ["backupSheetId missing."];
        }
        break;
      default:
        break;
    }

    const failed = stepErrors.length > 0 || planStep.status === "needs_config";
    drafts.push({
      deliveryPlanStepId: planStep.id,
      stepOrder: planStep.stepOrder,
      stepType: planStep.stepType,
      targetSystem: planStep.targetSystem ?? "ghl",
      targetId: planStep.targetId,
      mode,
      status: failed ? "failed_validation" : "simulated",
      title: planStep.title,
      requestPreviewJson: request,
      responsePreviewJson: {
        simulated: true,
        externalCallExecuted: false,
        note: "Payload preview only — no GHL API call.",
      },
      validationErrors: stepErrors,
      warnings: stepWarnings,
    });
  }

  return drafts;
}

export async function buildAdapterSimulation(
  planId: string,
  opts: { checkLiveReadiness?: boolean; fetchImpl?: typeof fetch } = {}
): Promise<
  | { simulation: GhlAdapterSimulationResult; context: GhlAdapterPlanContext }
  | { notFound: true }
> {
  const plan = await findDeliveryPlanById(planId);
  if (!plan) return { notFound: true };

  let rule: CampaignRoutingRule | null = null;
  if (plan.routingDryRunDecisionId) {
    const decision = await findRoutingDryRunDecisionById(plan.routingDryRunDecisionId);
    if (decision) {
      rule = (await resolveDeliveryPlanRule(decision)).rule;
    }
  }

  const ctx: GhlAdapterPlanContext = { plan, rule };
  try {
    const previewContext = await loadRecordedDeliveryPreviewContext(plan);
    ctx.destinationFieldMapping = previewContext.destinationFieldMapping;
    ctx.sourceEnrichment = previewContext.sourceEnrichment;
  } catch {
    // The simulation still previews identity fields when the recorded context cannot be loaded.
  }
  const envMode = getGhlDeliveryAdapterMode();
  const recordMode = adapterSimulationRecordMode(envMode);
  const validation = validateDeliveryPlanForGhlSimulation(ctx);

  if (envMode === "live_blocked" || (opts.checkLiveReadiness && rule)) {
    try {
      const duplicateRisk = plan.routingDryRunDecisionId
        ? await getDuplicateRiskForRoutingDecision(plan.routingDryRunDecisionId)
        : null;
      if (rule) assertLiveDeliveryAllowed(ruleToReadinessInput(rule), { duplicateRisk });
    } catch {
      validation.errors.push(GHL_LIVE_NOT_IMPLEMENTED);
    }
  }

  if (envMode === "disabled") {
    return {
      context: ctx,
      simulation: {
        mode: recordMode,
        status: "disabled",
        validation,
        stepDrafts: [],
        summary: "GHL adapter is disabled (GHL_DELIVERY_ADAPTER_MODE=disabled).",
        warnings: validation.warnings,
        errors: ["Adapter simulation is disabled by environment configuration."],
      },
    };
  }

  let probeResult: GhlAdapterSimulationResult["probeResult"];
  if (envMode === "readonly_probe") {
    probeResult = await probeGhlLocationReadonly(
      plan.destinationSubaccountIdGhl,
      opts.fetchImpl
    );
  }

  const stepDrafts = buildStepDrafts(ctx, recordMode, validation);
  const hasFailures =
    !validation.valid || stepDrafts.some((s) => s.status === "failed_validation");

  let status = "simulated";
  if (envMode === "readonly_probe") {
    status = probeResult?.ok ? "readonly_probe_passed" : "readonly_probe_failed";
  }
  if (hasFailures) status = "failed_validation";

  return {
    context: ctx,
    simulation: {
      mode: recordMode,
      status,
      validation,
      stepDrafts,
      summary: `GHL adapter ${recordMode}: ${stepDrafts.length} steps simulated; no external writes.`,
      warnings: validation.warnings,
      errors: validation.errors,
      probeResult,
    },
  };
}

function fieldMapForWritePlan(
  ctx: GhlAdapterPlanContext
): Record<string, { ghlFieldKey: string; requirement?: string | null }> {
  const enriched = ctx.sourceEnrichment?.sourceAttributeFieldMap;
  if (enriched) {
    return Object.fromEntries(
      Object.entries(enriched).map(([key, entry]) => [
        key,
        { ghlFieldKey: entry.ghlFieldKey, requirement: entry.requirement ?? null },
      ])
    );
  }
  const raw = ctx.destinationFieldMapping?.sourceAttributeFieldMapJson;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, { ghlFieldKey: string; requirement?: string | null }> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      out[key] = { ghlFieldKey: value.trim(), requirement: "optional" };
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const ghlFieldKey = typeof record.ghlFieldKey === "string" ? record.ghlFieldKey.trim() : "";
    if (!ghlFieldKey) continue;
    out[key] = {
      ghlFieldKey,
      requirement: typeof record.requirement === "string" ? record.requirement : null,
    };
  }
  return out;
}

function vetWritePlanForContext(ctx: GhlAdapterPlanContext) {
  const names = planContactNamesFromContext(ctx);
  const notesEnabled =
    ctx.destinationFieldMapping?.intakeSummaryNotesEnabled === true ||
    ctx.sourceEnrichment?.sourceEnrichmentPolicy.intakeSummaryNotesEnabled === true;
  return presentVetWritePlan({
    native: {
      firstName: names.firstName,
      lastName: names.lastName,
      email: ctx.plan.sourceEmail,
      phone: ctx.plan.sourcePhoneE164,
      source: "sa360",
      normalizedPayload: ctx.sourceEnrichment?.normalizedPayload,
      sourceAttributes: ctx.sourceEnrichment?.sourceAttributes ?? null,
      receivedAt: ctx.sourceEnrichment?.receivedAt,
    },
    sourceAttributes: ctx.sourceEnrichment?.sourceAttributes ?? null,
    fieldMap: fieldMapForWritePlan(ctx),
    discoveredFields: ctx.destinationFieldMapping?.discoveredCustomFields ?? [],
    ignoredCanonicalKeys: ctx.sourceEnrichment?.sourceEnrichmentPolicy.ignoredCanonicalKeys,
    notesEnabled,
    noteEvent: {
      sourceLeadEventId: ctx.plan.sourceLeadUid?.trim() || ctx.plan.id,
      clientAccountId: ctx.plan.destinationClientAccountId,
      email: ctx.plan.sourceEmail,
      phone: ctx.plan.sourcePhoneE164,
      generatedAt: ctx.sourceEnrichment?.receivedAt ?? null,
    },
  });
}

export function assertGhlLiveModeNotAllowed(requestedMode?: string): void {
  if (requestedMode === "live") {
    throw new Error(GHL_LIVE_NOT_IMPLEMENTED);
  }
}

export type PresentedAdapterRun = GhlDeliveryAdapterRun & {
  stepRuns: GhlDeliveryAdapterStepRun[];
};
