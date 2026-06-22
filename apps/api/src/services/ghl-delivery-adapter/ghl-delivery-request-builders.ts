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

export type PlanContactNames = {
  firstName: string | null;
  lastName: string | null;
};

/** Read normalized contact names from delivery plan step previews (direct canary / shadow). */
export function planContactNamesFromContext(ctx: GhlAdapterPlanContext): PlanContactNames {
  const steps = ctx.plan.steps ?? [];
  for (const stepType of ["create_or_update_contact", "normalize_lead"] as const) {
    const step = steps.find((s) => s.stepType === stepType);
    const preview = step?.requestPreviewJson;
    if (!preview || typeof preview !== "object" || Array.isArray(preview)) continue;
    const record = preview as Record<string, unknown>;
    if (stepType === "create_or_update_contact") {
      const contact = record.contact;
      if (contact && typeof contact === "object" && !Array.isArray(contact)) {
        const c = contact as Record<string, unknown>;
        const first = trim(typeof c.firstName === "string" ? c.firstName : null);
        const last = trim(typeof c.lastName === "string" ? c.lastName : null);
        if (first || last) return { firstName: first, lastName: last };
      }
    }
    const first = trim(typeof record.firstName === "string" ? record.firstName : null);
    const last = trim(typeof record.lastName === "string" ? record.lastName : null);
    if (first || last) return { firstName: first, lastName: last };
  }
  return { firstName: null, lastName: null };
}

const INVALID_GHL_USER_ID_TOKENS = new Set(["null", "undefined", "none", ""]);

export function isValidGhlAssignedUserId(
  value: string | null | undefined
): value is string {
  const t = trim(value);
  if (!t) return false;
  return !INVALID_GHL_USER_ID_TOKENS.has(t.toLowerCase());
}

export function buildOpportunityDisplayName(ctx: GhlAdapterPlanContext): string {
  const niche = trim(ctx.plan.nicheKey ?? ctx.rule?.nicheKey);
  const email = trim(ctx.plan.sourceEmail);
  const leadUid = trim(ctx.plan.sourceLeadUid);
  const base = niche ? `${niche.toUpperCase()} lead` : "SA360 lead";
  const suffix = email ?? (leadUid ? leadUid.slice(0, 32) : "direct delivery");
  return `${base} — ${suffix}`.slice(0, 120);
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

/** Live GHL upsert: core contact fields only; SA360 custom fields are stamped in a follow-up PUT. */
export function buildLiveContactUpsertHttpBody(
  preview: GhlContactUpsertPreview
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    locationId: preview.locationId,
  };
  if (preview.body.email) body.email = preview.body.email;
  if (preview.body.phone) body.phone = preview.body.phone;
  if (preview.body.source) body.source = preview.body.source;
  if (preview.body.firstName) body.firstName = preview.body.firstName;
  if (preview.body.lastName) body.lastName = preview.body.lastName;
  if (preview.body.state) body.state = preview.body.state;
  return body;
}

export function buildContactUpsertRequest(
  ctx: GhlAdapterPlanContext,
  customFieldsOverride?: Record<string, string | null>
): GhlContactUpsertPreview {
  const locationId = trim(ctx.plan.destinationSubaccountIdGhl) ?? "";
  const customFields = customFieldsOverride ?? buildCustomFieldsMap(ctx);
  const names = planContactNamesFromContext(ctx);
  return {
    method: "POST",
    path: "/contacts/upsert",
    locationId,
    body: {
      firstName: names.firstName,
      lastName: names.lastName,
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
      name: buildOpportunityDisplayName(ctx),
      status: "open",
    },
  };
}

/** Live GHL opportunity create — contactId must be the ID returned from contact upsert. */
export function buildLiveOpportunityHttpBody(
  ctx: GhlAdapterPlanContext,
  contactIdGhl: string
): Record<string, unknown> | null {
  const preview = buildOpportunityRequest(ctx);
  if (!preview) return null;
  return {
    locationId: preview.locationId,
    pipelineId: preview.body.pipelineId,
    pipelineStageId: preview.body.pipelineStageId,
    contactId: contactIdGhl,
    name: preview.body.name,
    status: preview.body.status,
  };
}

export function buildAssignOwnerRequest(ctx: GhlAdapterPlanContext): GhlAssignOwnerPreview | null {
  const assignedTo = trim(ctx.rule?.defaultAssignedUserIdGhl);
  if (!isValidGhlAssignedUserId(assignedTo)) return null;
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

/** Whether opportunity delivery is intended for this rule (enabled, or partially configured). */
export function isOpportunityDeliveryExpected(ctx: GhlAdapterPlanContext): boolean {
  if (ctx.rule?.opportunityCreationEnabled === false) return false;
  if (ctx.rule?.opportunityCreationEnabled === true) return true;
  // Undefined/null: treat as expected only if the operator started configuring pipeline/stage.
  return Boolean(
    trim(ctx.rule?.destinationPipelineIdGhl) || trim(ctx.rule?.destinationPipelineStageIdGhl)
  );
}

export type LiveOpportunityPreflightResult = {
  ok: boolean;
  issues: string[];
  missingConfig: string[];
};

/** Known destination pipeline/stage topology, used to validate config membership when available. */
export type KnownPipelineConfig = {
  pipelineIds?: ReadonlySet<string>;
  stageIdsByPipeline?: ReadonlyMap<string, ReadonlySet<string>>;
};

/**
 * Validate everything needed for a live GHL opportunity create *before* the external POST,
 * so misconfiguration is reported as a config issue instead of a blind GHL 400.
 */
export function validateLiveOpportunityPreflight(
  ctx: GhlAdapterPlanContext,
  contactIdGhl: string | null,
  knownConfig?: KnownPipelineConfig
): LiveOpportunityPreflightResult {
  const issues: string[] = [];
  const missingConfig: string[] = [];
  const locationId = trim(ctx.plan.destinationSubaccountIdGhl);
  const pipelineId = trim(ctx.rule?.destinationPipelineIdGhl);
  const stageId = trim(ctx.rule?.destinationPipelineStageIdGhl);
  const contactId = trim(contactIdGhl);
  const name = trim(buildOpportunityDisplayName(ctx));

  if (!locationId) {
    issues.push("Destination location ID (GHL subaccount) is missing.");
    missingConfig.push("destinationSubaccountIdGhl");
  }
  if (!pipelineId) {
    issues.push("Destination pipeline ID is missing.");
    missingConfig.push("destinationPipelineIdGhl");
  }
  if (!stageId) {
    issues.push("Destination pipeline stage ID is missing.");
    missingConfig.push("destinationPipelineStageIdGhl");
  }
  if (!contactId) {
    issues.push("Contact ID is missing after contact upsert.");
  }
  if (!name) {
    issues.push("Opportunity name is empty.");
  }

  if (knownConfig && pipelineId) {
    if (
      knownConfig.pipelineIds &&
      knownConfig.pipelineIds.size > 0 &&
      !knownConfig.pipelineIds.has(pipelineId)
    ) {
      issues.push(`Pipeline ${pipelineId} does not belong to the destination location config.`);
      missingConfig.push("destinationPipelineIdGhl");
    }
    if (stageId && knownConfig.stageIdsByPipeline) {
      const stages = knownConfig.stageIdsByPipeline.get(pipelineId);
      if (stages && stages.size > 0 && !stages.has(stageId)) {
        issues.push(`Pipeline stage ${stageId} does not belong to pipeline ${pipelineId}.`);
        missingConfig.push("destinationPipelineStageIdGhl");
      }
    }
  }

  return { ok: issues.length === 0, issues, missingConfig: [...new Set(missingConfig)] };
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
