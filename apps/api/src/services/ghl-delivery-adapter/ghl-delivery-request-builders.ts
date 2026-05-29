import type {
  GhlAdapterPlanContext,
  GhlContactUpsertPreview,
  GhlCustomFieldStampPreview,
  GhlOpportunityPreview,
  GhlTagPreview,
  GhlAssignOwnerPreview,
  GhlWorkflowStartPreview,
  GhlBackupSheetPreview,
  GhlValidationResult,
} from "./ghl-delivery-adapter.types.js";

function trim(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function nicheTag(nicheKey: string | null | undefined): string | null {
  const n = trim(nicheKey);
  return n ? `SA360::NICHE::${n.toUpperCase()}` : null;
}

function sourceTag(sourcePlatform: string | null | undefined): string | null {
  const s = trim(sourcePlatform);
  return s ? `SA360::SOURCE::${s.toUpperCase()}` : null;
}

function clientTag(clientAccountId: string | null | undefined): string | null {
  const c = trim(clientAccountId);
  return c ? `SA360::CLIENT::${c}` : null;
}

export function buildCustomFieldsMap(ctx: GhlAdapterPlanContext): Record<string, string | null> {
  const { plan, rule } = ctx;
  return {
    sa360_lead_uid: plan.sourceLeadUid,
    sa360_client_account_id: plan.destinationClientAccountId,
    sa360_niche_key: trim(plan.nicheKey ?? rule?.nicheKey),
    sa360_niche_label: trim(plan.nicheKey ?? rule?.nicheKey),
    sa360_source_platform: null,
    sa360_source_type: null,
    sa360_campaign_id: null,
    sa360_campaign_name: null,
    sa360_adset_id: null,
    sa360_ad_id: null,
    sa360_utm_campaign: null,
    sa360_utm_content: null,
    sa360_lifecycle_stage: "NEW",
    sa360_routing_status: "DELIVERY_PLANNED",
    sa360_backend_sync_status: "GHL_ADAPTER_SIMULATED",
  };
}

export function buildLiveCanaryCustomFieldsMap(
  ctx: GhlAdapterPlanContext,
  idempotencyKey: string
): Record<string, string | null> {
  return {
    ...buildCustomFieldsMap(ctx),
    sa360_delivery_idempotency_key: idempotencyKey,
    sa360_delivery_plan_id: ctx.plan.id,
    sa360_delivery_mode: "live_canary",
    sa360_backend_sync_status: "GHL_LIVE_CANARY",
    sa360_routing_status: "LIVE_CANARY_PENDING",
  };
}

export function buildContactUpsertRequest(
  ctx: GhlAdapterPlanContext,
  customFieldsOverride?: Record<string, string | null>
): GhlContactUpsertPreview {
  const locationId = trim(ctx.plan.destinationSubaccountIdGhl) ?? "";
  const customFields = customFieldsOverride ?? buildCustomFieldsMap(ctx);
  return {
    method: "POST",
    path: "/contacts/upsert",
    locationId,
    body: {
      firstName: null,
      lastName: null,
      email: planContactField(ctx, "email"),
      phone: planContactField(ctx, "phone"),
      state: null,
      source: "sa360",
      customFields,
    },
  };
}

function planContactField(
  ctx: GhlAdapterPlanContext,
  field: "email" | "phone"
): string | null {
  if (field === "email") return trim(ctx.plan.sourceEmail);
  return trim(ctx.plan.sourcePhoneE164);
}

export function buildCustomFieldStampRequest(
  ctx: GhlAdapterPlanContext,
  customFieldsOverride?: Record<string, string | null>
): GhlCustomFieldStampPreview {
  return {
    method: "PUT",
    path: "/contacts/:contactId",
    locationId: trim(ctx.plan.destinationSubaccountIdGhl) ?? "",
    customFields: customFieldsOverride ?? buildCustomFieldsMap(ctx),
  };
}

export function buildTagRequest(ctx: GhlAdapterPlanContext): GhlTagPreview {
  const tags = [
    nicheTag(ctx.plan.nicheKey ?? ctx.rule?.nicheKey),
    sourceTag(ctx.rule?.sourcePlatform),
    "SA360::EVENT::LEAD_CREATED",
    clientTag(ctx.plan.destinationClientAccountId),
  ].filter((t): t is string => Boolean(t));

  return {
    method: "POST",
    path: "/contacts/:contactId/tags",
    locationId: trim(ctx.plan.destinationSubaccountIdGhl) ?? "",
    tags,
  };
}

export function buildOpportunityRequest(ctx: GhlAdapterPlanContext): GhlOpportunityPreview | null {
  const rule = ctx.rule;
  if (rule?.opportunityCreationEnabled === false) return null;
  const pipelineId = trim(rule?.destinationPipelineIdGhl);
  const pipelineStageId = trim(rule?.destinationPipelineStageIdGhl);
  if (!pipelineId || !pipelineStageId) return null;
  return {
    method: "POST",
    path: "/opportunities/",
    locationId: trim(ctx.plan.destinationSubaccountIdGhl) ?? "",
    body: {
      pipelineId,
      pipelineStageId,
      contactId: trim(ctx.plan.sourceContactIdGhl),
    },
  };
}

export function buildAssignOwnerRequest(ctx: GhlAdapterPlanContext): GhlAssignOwnerPreview | null {
  const assignedTo = trim(ctx.rule?.defaultAssignedUserIdGhl);
  if (!assignedTo) return null;
  return {
    method: "PUT",
    path: "/contacts/:contactId",
    locationId: trim(ctx.plan.destinationSubaccountIdGhl) ?? "",
    assignedTo,
  };
}

export function buildWorkflowStartRequest(ctx: GhlAdapterPlanContext): GhlWorkflowStartPreview | null {
  const workflowId = trim(ctx.rule?.destinationWorkflowIdGhl);
  if (!workflowId) return null;
  return {
    method: "POST",
    path: "/contacts/:contactId/workflow/:workflowId",
    locationId: trim(ctx.plan.destinationSubaccountIdGhl) ?? "",
    workflowId,
  };
}

export function buildBackupSheetPreview(ctx: GhlAdapterPlanContext): GhlBackupSheetPreview {
  const rule = ctx.rule;
  return {
    targetSystem: "google_sheets",
    method: "APPEND",
    spreadsheetId: trim(rule?.backupSheetId),
    rowPreview: {
      leadUid: trim(ctx.plan.sourceLeadUid),
      clientAccountId: trim(ctx.plan.destinationClientAccountId),
      subaccountId: trim(ctx.plan.destinationSubaccountIdGhl),
    },
  };
}

export function validateContactPayload(ctx: GhlAdapterPlanContext): GhlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingConfig: string[] = [];
  const locationId = trim(ctx.plan.destinationSubaccountIdGhl);
  if (!locationId) {
    errors.push("destinationSubaccountIdGhl is required for GHL contact upsert.");
    missingConfig.push("destinationSubaccountIdGhl");
  }
  if (!trim(ctx.plan.sourceLeadUid)) {
    errors.push("sourceLeadUid is required.");
  }
  if (!trim(ctx.plan.sourceEmail) && !trim(ctx.plan.sourcePhoneE164)) {
    warnings.push("Neither email nor phone on plan; GHL upsert may be weak.");
  }
  return { valid: errors.length === 0, errors, warnings, missingConfig };
}

export function validateWorkflowStartConfig(ctx: GhlAdapterPlanContext): GhlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingConfig: string[] = [];
  if (!trim(ctx.rule?.destinationWorkflowIdGhl)) {
    errors.push("destinationWorkflowIdGhl is not configured.");
    missingConfig.push("destinationWorkflowIdGhl");
  }
  return { valid: errors.length === 0, errors, warnings, missingConfig };
}

export function validateOpportunityConfig(ctx: GhlAdapterPlanContext): GhlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingConfig: string[] = [];
  if (ctx.rule?.opportunityCreationEnabled === false) {
    return { valid: true, errors, warnings, missingConfig };
  }
  if (!trim(ctx.rule?.destinationPipelineIdGhl)) {
    errors.push("destinationPipelineIdGhl is missing.");
    missingConfig.push("destinationPipelineIdGhl");
  }
  if (!trim(ctx.rule?.destinationPipelineStageIdGhl)) {
    errors.push("destinationPipelineStageIdGhl is missing.");
    missingConfig.push("destinationPipelineStageIdGhl");
  }
  return { valid: errors.length === 0, errors, warnings, missingConfig };
}

export function validateDeliveryPlanForGhlSimulation(
  ctx: GhlAdapterPlanContext
): GhlValidationResult {
  const contact = validateContactPayload(ctx);
  const workflow = validateWorkflowStartConfig(ctx);
  const opportunity = validateOpportunityConfig(ctx);
  const errors = [...contact.errors, ...workflow.errors, ...opportunity.errors];
  const warnings = [...contact.warnings, ...workflow.warnings, ...opportunity.warnings];
  const missingConfig = [
    ...new Set([...contact.missingConfig, ...workflow.missingConfig, ...opportunity.missingConfig]),
  ];
  if (!ctx.rule) {
    errors.push("No CampaignRoutingRule linked to this delivery plan.");
  }
  if (ctx.plan.status === "blocked") {
    errors.push("Delivery plan status is blocked.");
  }
  return { valid: errors.length === 0, errors, warnings, missingConfig };
}
