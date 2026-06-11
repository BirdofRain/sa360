import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";
import {
  buildAssignOwnerRequest,
  buildContactUpsertRequest,
  buildCustomFieldStampRequest,
  buildLiveCanaryCustomFieldsMap,
  buildLiveContactUpsertHttpBody,
  buildLiveOpportunityHttpBody,
  buildOpportunityRequest,
  buildTagRequest,
  buildWorkflowStartRequest,
} from "./ghl-delivery-request-builders.js";
import {
  buildCustomFieldStampReport,
  formatCustomFieldStampWarning,
} from "./ghl-custom-field-stamp.report.js";
import { resolveAndAssessSa360FieldMapping } from "../sa360-custom-field-mapping.service.js";
import {
  buildCustomFieldsForPutFromMap,
  extractContactIdFromGhlResponse,
  extractOpportunityIdFromGhlResponse,
  formatCustomFieldStampFailureDetail,
  ghlLiveJson,
  parseGhlApiErrorSummary,
  summarizeCustomFieldsPutPayload,
  type GhlLiveHttpDeps,
} from "./ghl-live-transport.js";
import { parseSa360CustomFieldIdMapJson } from "../sa360-custom-field-mapping.service.js";
import {
  resolveWorkflowTriggerMode,
  WORKFLOW_TAG_TRIGGER_DETAIL,
  WORKFLOW_TRIGGER_TAG,
} from "./ghl-workflow-trigger-mode.js";
import { saveLifecycleEvent } from "../event-service.js";
import type { LifecycleEventNameInternal } from "../../schemas/lifecycle-event-names.js";
import {
  deriveLiveCanaryRunStatus,
  getLiveCanaryStepRequirementFlags,
  isRequiredDeliveryPathComplete,
  liveCanaryRunSummaryForStatus,
} from "./ghl-live-canary-step-requirements.js";

export type LiveCanaryStepOutcome = {
  stepOrder: number;
  stepType: string;
  deliveryPlanStepId: string | null;
  status: "succeeded" | "failed" | "skipped" | "blocked" | "optional_failed";
  targetSystem: string;
  targetId: string | null;
  externalId: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  warnings: string[];
  requestRedactedJson: Prisma.InputJsonValue | null;
  responseRedactedJson: Prisma.InputJsonValue | null;
  startedAt: Date;
  completedAt: Date;
  externalCallExecuted: boolean;
};

export type LiveCanaryExecutionResult = {
  contactIdGhl: string | null;
  opportunityIdGhl: string | null;
  workflowStarted: boolean;
  stepOutcomes: LiveCanaryStepOutcome[];
  runStatus: "succeeded" | "partial_success" | "failed";
  summary: string;
  errors: string[];
  warnings: string[];
};

const defaultDeps: GhlLiveHttpDeps = { fetch: globalThis.fetch.bind(globalThis) };

function workflowDirectApiSkipDetail(locationId: string | null): string {
  const loc = locationId?.trim() || "this subaccount";
  return `Direct workflow API enrollment may not be supported for this workflow — verify it is published for ${loc}, or use a tag-based GHL trigger for long-term launch.`;
}

function findPlanStepId(ctx: GhlAdapterPlanContext, stepType: string): string | null {
  const step = ctx.plan.steps.find((s) => s.stepType === stepType);
  return step?.id ?? null;
}

async function emitDeliveryLifecycleEvent(
  ctx: GhlAdapterPlanContext,
  eventName: LifecycleEventNameInternal,
  contactIdGhl?: string | null
) {
  const leadUid = ctx.plan.sourceLeadUid?.trim() || `plan_${ctx.plan.id}`;
  await saveLifecycleEvent({
    schema_version: "1.0",
    client_account_id: ctx.plan.destinationClientAccountId,
    subaccount_id_ghl: ctx.plan.destinationSubaccountIdGhl,
    contact: {
      lead_uid: leadUid,
      contact_id_ghl: contactIdGhl ?? ctx.plan.sourceContactIdGhl ?? undefined,
      email: ctx.plan.sourceEmail ?? undefined,
      phone_e164: ctx.plan.sourcePhoneE164 ?? undefined,
    },
    state: {
      routing_status: "live_canary",
      lifecycle_stage: "NEW",
    },
    event: {
      event_uuid: randomUUID(),
      event_name_internal: eventName,
      event_name_meta: eventName,
      send_to_meta: false,
    },
  });
}

export async function executeLiveCanaryGhlSteps(
  ctx: GhlAdapterPlanContext,
  idempotencyKey: string,
  deps: GhlLiveHttpDeps = defaultDeps,
  opts?: {
    emitLifecycle?: (
      eventName: LifecycleEventNameInternal,
      contactIdGhl?: string | null
    ) => Promise<void>;
  }
): Promise<LiveCanaryExecutionResult> {
  const emitLifecycle =
    opts?.emitLifecycle ??
    (async (eventName: LifecycleEventNameInternal, contactIdGhl?: string | null) => {
      await emitDeliveryLifecycleEvent(ctx, eventName, contactIdGhl);
    });
  const customFields = buildLiveCanaryCustomFieldsMap(ctx, idempotencyKey);
  const ghlLocationId = ctx.plan.destinationSubaccountIdGhl?.trim() || null;
  const stepOutcomes: LiveCanaryStepOutcome[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let contactIdGhl: string | null = null;
  let opportunityIdGhl: string | null = null;
  let workflowStarted = false;
  let order = 1;
  let contactFailed = false;
  let opportunityFailed = false;
  let opportunityConfigured = false;
  const stepFlags = getLiveCanaryStepRequirementFlags(ctx);
  const OWNER_SKIP_MESSAGE = "Owner assignment skipped — no valid GHL user configured.";

  const pushOutcome = (outcome: Omit<LiveCanaryStepOutcome, "stepOrder"> & { stepOrder?: number }) => {
    stepOutcomes.push({ stepOrder: outcome.stepOrder ?? order++, ...outcome });
  };

  await emitLifecycle("lead_delivery_started");

  const contactUpsertPreview = buildContactUpsertRequest(ctx);

  // create_or_update_contact
  {
    const startedAt = new Date();
    const preview = contactUpsertPreview;
    const upsertBody = buildLiveContactUpsertHttpBody(preview);
    const res = await ghlLiveJson(deps, preview.method, preview.path, {
      body: upsertBody,
      locationId: ghlLocationId,
    });
    contactIdGhl = extractContactIdFromGhlResponse(res.json);
    const ok = res.ok && Boolean(contactIdGhl);
    const ghlError = ok ? null : parseGhlApiErrorSummary(res.text, res.json);
    if (!ok) {
      contactFailed = true;
      errors.push(ghlError ?? "Contact upsert failed.");
    }
    pushOutcome({
      stepType: "create_or_update_contact",
      deliveryPlanStepId: findPlanStepId(ctx, "create_or_update_contact"),
      status: ok ? "succeeded" : "failed",
      targetSystem: "ghl",
      targetId: preview.locationId,
      externalId: contactIdGhl,
      errorCode: ok ? null : `http_${res.status || "transport"}`,
      errorSummary: ok ? null : ghlError,
      warnings: [],
      requestRedactedJson: res.redactedRequest as Prisma.InputJsonValue,
      responseRedactedJson: {
        ...(res.redactedResponse ?? {}),
        externalCallExecuted: true,
        contactIdGhl,
      } as Prisma.InputJsonValue,
      startedAt,
      completedAt: new Date(),
      externalCallExecuted: true,
    });
  }

  if (contactFailed) {
    await emitLifecycle("delivery_failed", contactIdGhl);
    return {
      contactIdGhl,
      opportunityIdGhl,
      workflowStarted,
      stepOutcomes,
      runStatus: "failed",
      summary: "Contact creation failed; remaining GHL write steps were not executed.",
      errors,
      warnings,
    };
  }

  await emitLifecycle("client_contact_created", contactIdGhl);

  // stamp_custom_fields
  {
    const startedAt = new Date();
    const stamp = buildCustomFieldStampRequest(ctx, {
      ...customFields,
      sa360_routing_status: "LIVE_CANARY_DELIVERED",
    });
    const destMap = parseSa360CustomFieldIdMapJson(
      ctx.destinationFieldMapping?.sa360CustomFieldIdMapJson
    );
    const hasDestinationFieldMap = Object.values(destMap).some((v) => v?.trim());
    const fieldMapping = resolveAndAssessSa360FieldMapping({
      destinationMapJson: ctx.destinationFieldMapping?.sa360CustomFieldIdMapJson,
      useEnvFallback: !hasDestinationFieldMap,
      customFieldStampRequired: ctx.destinationFieldMapping?.customFieldStampRequired,
    });
    const mapped = buildCustomFieldsForPutFromMap(fieldMapping.idMap, stamp.customFields);
    let ok = true;
    let resStatus = 200;
    let redactedResponse: Record<string, unknown> = { externalCallExecuted: true };

    const stampReport = buildCustomFieldStampReport(
      stamp.customFields,
      fieldMapping.idMap,
      fieldMapping
    );
    if (mapped.apiPayload.length === 0) {
      const stampWarning = formatCustomFieldStampWarning(stampReport);
      if (stampWarning) warnings.push(stampWarning);
      pushOutcome({
        stepType: "stamp_custom_fields",
        deliveryPlanStepId: findPlanStepId(ctx, "stamp_custom_fields"),
        status: "skipped",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode: null,
        errorSummary: stampReport.skippedReason,
        warnings: stampReport.skippedReason ? [stampReport.skippedReason] : [],
        requestRedactedJson: {
          note: "skipped_no_field_map",
          logicalKeysToStamp: stampReport.logicalKeysToStamp,
          configuredGhlFieldIds: stampReport.configuredGhlFieldIds,
          mappableKeys: stampReport.mappableKeys,
          unmappedKeys: stampReport.unmappedKeys,
        } as Prisma.InputJsonValue,
        responseRedactedJson: redactedResponse as Prisma.InputJsonValue,
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    } else if (contactIdGhl) {
      const customFieldsShape = summarizeCustomFieldsPutPayload(mapped);
      customFieldsShape.mappingSource = fieldMapping.source;
      const putBody: Record<string, unknown> = {
        locationId: stamp.locationId,
        customFields: mapped.apiPayload,
      };
      const putRes = await ghlLiveJson(deps, "PUT", `/contacts/${encodeURIComponent(contactIdGhl)}`, {
        body: putBody,
        locationId: ghlLocationId,
      });
      ok = putRes.ok;
      resStatus = putRes.status;
      redactedResponse = { ...(putRes.redactedResponse ?? {}), externalCallExecuted: true };
      const stampError = ok ? null : parseGhlApiErrorSummary(putRes.text, putRes.json);
      const stampOptional = !stepFlags.stampRequired;
      const stampDetail = ok
        ? null
        : formatCustomFieldStampFailureDetail({
            ghlError: stampError,
            shapeSummary: customFieldsShape,
            mappingSource: fieldMapping.source,
          });
      if (!ok) {
        const msg = stampDetail ?? "Custom field stamp failed after contact was created.";
        if (stampOptional) warnings.push(msg);
        else errors.push(msg);
      }
      const stampRequestMeta = {
        ...(putRes.redactedRequest && typeof putRes.redactedRequest === "object"
          ? putRes.redactedRequest
          : {}),
        customFieldsShape,
        fieldDiagnostics: mapped.diagnostics.map((d) => ({
          logicalKey: d.logicalKey,
          ghlFieldIdSuffix: d.ghlFieldId.length > 6 ? d.ghlFieldId.slice(-6) : d.ghlFieldId,
          valueType: d.valueType,
          valueLength: d.valueLength,
        })),
        logicalKeysStamped: stampReport.mappableKeys,
        configuredGhlFieldIdCount: stampReport.configuredGhlFieldIds.length,
        mappingSource: fieldMapping.source,
      };
      pushOutcome({
        stepType: "stamp_custom_fields",
        deliveryPlanStepId: findPlanStepId(ctx, "stamp_custom_fields"),
        status: ok ? "succeeded" : stampOptional ? "optional_failed" : "failed",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode: ok ? null : `http_${resStatus || "transport"}`,
        errorSummary: ok ? null : stampDetail,
        warnings: !ok && stampOptional ? ["Optional custom field stamp failed."] : [],
        requestRedactedJson: stampRequestMeta as Prisma.InputJsonValue,
        responseRedactedJson: redactedResponse as Prisma.InputJsonValue,
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: true,
      });
    }
  }

  // add_tags
  {
    const startedAt = new Date();
    const tagsPreview = buildTagRequest(ctx);
    const res = await ghlLiveJson(
      deps,
      tagsPreview.method,
      `/contacts/${encodeURIComponent(contactIdGhl!)}/tags`,
      { body: { tags: tagsPreview.tags }, locationId: ghlLocationId }
    );
    const ok = res.ok;
    const tagError = ok ? null : parseGhlApiErrorSummary(res.text, res.json);
    if (!ok) warnings.push(tagError ?? "Tag add failed after contact was created.");
    pushOutcome({
      stepType: "add_tags",
      deliveryPlanStepId: findPlanStepId(ctx, "add_tags"),
      status: ok ? "succeeded" : "failed",
      targetSystem: "ghl",
      targetId: contactIdGhl,
      externalId: null,
      errorCode: ok ? null : `http_${res.status || "transport"}`,
      errorSummary: ok ? null : tagError,
      warnings: ok ? [] : ["Non-fatal tag failure."],
      requestRedactedJson: res.redactedRequest as Prisma.InputJsonValue,
      responseRedactedJson: {
        ...(res.redactedResponse ?? {}),
        externalCallExecuted: true,
      } as Prisma.InputJsonValue,
      startedAt,
      completedAt: new Date(),
      externalCallExecuted: true,
    });
  }

  // create_or_update_opportunity
  const oppPreview = buildOpportunityRequest(ctx);
  const oppBody = contactIdGhl ? buildLiveOpportunityHttpBody(ctx, contactIdGhl) : null;
  opportunityConfigured = Boolean(oppPreview && oppBody);
  if (oppPreview && oppBody) {
    const startedAt = new Date();
    const res = await ghlLiveJson(deps, oppPreview.method, oppPreview.path, {
      body: oppBody,
      locationId: ghlLocationId,
    });
    opportunityIdGhl = extractOpportunityIdFromGhlResponse(res.json);
    const ok = res.ok && Boolean(opportunityIdGhl);
    const oppError = ok ? null : parseGhlApiErrorSummary(res.text, res.json);
    if (!ok) {
      opportunityFailed = true;
      const detail = oppError ?? "Opportunity creation failed.";
      errors.push(detail);
      warnings.push(`Opportunity creation failed: ${detail}`);
    }
    pushOutcome({
      stepType: "create_or_update_opportunity",
      deliveryPlanStepId: findPlanStepId(ctx, "create_or_update_opportunity"),
      status: ok ? "succeeded" : "failed",
      targetSystem: "ghl",
      targetId: oppPreview.locationId,
      externalId: opportunityIdGhl,
      errorCode: ok ? null : `http_${res.status || "transport"}`,
      errorSummary: ok ? null : oppError,
      warnings: ok ? [] : ["Opportunity creation required before workflow start."],
      requestRedactedJson: res.redactedRequest as Prisma.InputJsonValue,
      responseRedactedJson: {
        ...(res.redactedResponse ?? {}),
        externalCallExecuted: true,
        opportunityIdGhl,
      } as Prisma.InputJsonValue,
      startedAt,
      completedAt: new Date(),
      externalCallExecuted: true,
    });
  } else {
    pushOutcome({
      stepType: "create_or_update_opportunity",
      deliveryPlanStepId: findPlanStepId(ctx, "create_or_update_opportunity"),
      status: "skipped",
      targetSystem: "ghl",
      targetId: null,
      externalId: null,
      errorCode: null,
      errorSummary: "Opportunity not configured for this rule.",
      warnings: [],
      requestRedactedJson: null,
      responseRedactedJson: { externalCallExecuted: false } as Prisma.InputJsonValue,
      startedAt: new Date(),
      completedAt: new Date(),
      externalCallExecuted: false,
    });
  }

  // assign_owner
  const ownerPreview = buildAssignOwnerRequest(ctx);
  if (ownerPreview && contactIdGhl) {
    const startedAt = new Date();
    const res = await ghlLiveJson(deps, ownerPreview.method, `/contacts/${encodeURIComponent(contactIdGhl)}`, {
      body: { locationId: ownerPreview.locationId, assignedTo: ownerPreview.assignedTo },
      locationId: ghlLocationId,
    });
    const ok = res.ok;
    const ownerError = ok ? null : parseGhlApiErrorSummary(res.text, res.json);
    const ownerOptional = !stepFlags.ownerRequired;
    if (!ok) {
      const msg =
        ownerError ??
        `Configured owner ID may be invalid for this location (${ownerPreview.assignedTo}).`;
      if (ownerOptional) warnings.push(msg);
      else errors.push(msg);
    }
    pushOutcome({
      stepType: "assign_owner",
      deliveryPlanStepId: findPlanStepId(ctx, "assign_owner"),
      status: ok ? "succeeded" : ownerOptional ? "optional_failed" : "failed",
      targetSystem: "ghl",
      targetId: ownerPreview.assignedTo,
      externalId: contactIdGhl,
      errorCode: ok ? null : `http_${res.status || "transport"}`,
      errorSummary: ok ? null : ownerError,
      warnings: !ok && ownerOptional ? ["Optional owner assignment failed."] : [],
      requestRedactedJson: res.redactedRequest as Prisma.InputJsonValue,
      responseRedactedJson: {
        ...(res.redactedResponse ?? {}),
        externalCallExecuted: true,
      } as Prisma.InputJsonValue,
      startedAt,
      completedAt: new Date(),
      externalCallExecuted: true,
    });
  } else {
    pushOutcome({
      stepType: "assign_owner",
      deliveryPlanStepId: findPlanStepId(ctx, "assign_owner"),
      status: "skipped",
      targetSystem: "ghl",
      targetId: null,
      externalId: null,
      errorCode: null,
      errorSummary: OWNER_SKIP_MESSAGE,
      warnings: [OWNER_SKIP_MESSAGE],
      requestRedactedJson: null,
      responseRedactedJson: { externalCallExecuted: false } as Prisma.InputJsonValue,
      startedAt: new Date(),
      completedAt: new Date(),
      externalCallExecuted: false,
    });
    warnings.push(OWNER_SKIP_MESSAGE);
  }

  // start_workflow / workflow trigger (tag or direct API per destination config)
  const workflowTriggerMode = resolveWorkflowTriggerMode(ctx);
  const wfPreview = buildWorkflowStartRequest(ctx);
  if (workflowTriggerMode === "none") {
    pushOutcome({
      stepType: "start_workflow",
      deliveryPlanStepId: findPlanStepId(ctx, "start_workflow"),
      status: "skipped",
      targetSystem: "ghl",
      targetId: null,
      externalId: contactIdGhl,
      errorCode: null,
      errorSummary: "Workflow trigger disabled (workflowTriggerMode=none).",
      warnings: ["Workflow trigger disabled on destination config."],
      requestRedactedJson: null,
      responseRedactedJson: { externalCallExecuted: false } as Prisma.InputJsonValue,
      startedAt: new Date(),
      completedAt: new Date(),
      externalCallExecuted: false,
    });
  } else if (workflowTriggerMode === "tag_trigger" && contactIdGhl && !opportunityFailed) {
    const startedAt = new Date();
    const res = await ghlLiveJson(
      deps,
      "POST",
      `/contacts/${encodeURIComponent(contactIdGhl)}/tags`,
      { body: { tags: [WORKFLOW_TRIGGER_TAG] }, locationId: ghlLocationId }
    );
    const ok = res.ok;
    const tagError = ok ? null : parseGhlApiErrorSummary(res.text, res.json);
    const workflowOptional = !stepFlags.workflowRequired;
    if (!ok) {
      const msg = tagError ?? "Workflow trigger tag could not be added.";
      if (workflowOptional) warnings.push(msg);
      else errors.push(msg);
    }
    pushOutcome({
      stepType: "start_workflow",
      deliveryPlanStepId: findPlanStepId(ctx, "start_workflow"),
      status: ok ? "succeeded" : workflowOptional ? "optional_failed" : "failed",
      targetSystem: "ghl",
      targetId: WORKFLOW_TRIGGER_TAG,
      externalId: contactIdGhl,
      errorCode: ok ? null : `http_${res.status || "transport"}`,
      errorSummary: ok ? WORKFLOW_TAG_TRIGGER_DETAIL : tagError,
      warnings: ok ? [WORKFLOW_TAG_TRIGGER_DETAIL] : [],
      requestRedactedJson: res.redactedRequest as Prisma.InputJsonValue,
      responseRedactedJson: {
        ...(res.redactedResponse ?? {}),
        externalCallExecuted: true,
        workflowTriggerMode: "tag_trigger",
      } as Prisma.InputJsonValue,
      startedAt,
      completedAt: new Date(),
      externalCallExecuted: true,
    });
  } else if (wfPreview && contactIdGhl && opportunityFailed) {
    const skipReason = "Workflow skipped — opportunity creation did not succeed.";
    warnings.push(skipReason);
    pushOutcome({
      stepType: "start_workflow",
      deliveryPlanStepId: findPlanStepId(ctx, "start_workflow"),
      status: "skipped",
      targetSystem: "ghl",
      targetId: wfPreview.workflowId,
      externalId: contactIdGhl,
      errorCode: null,
      errorSummary: skipReason,
      warnings: [skipReason],
      requestRedactedJson: null,
      responseRedactedJson: { externalCallExecuted: false } as Prisma.InputJsonValue,
      startedAt: new Date(),
      completedAt: new Date(),
      externalCallExecuted: false,
    });
  } else if (workflowTriggerMode === "direct_api" && wfPreview && contactIdGhl) {
    const startedAt = new Date();
    const path = `/contacts/${encodeURIComponent(contactIdGhl)}/workflow/${encodeURIComponent(wfPreview.workflowId)}`;
    const res = await ghlLiveJson(deps, wfPreview.method, path, {
      body: { locationId: wfPreview.locationId },
      locationId: ghlLocationId,
    });
    workflowStarted = res.ok;
    const wfError = res.ok ? null : parseGhlApiErrorSummary(res.text, res.json);
    const workflowOptional = !stepFlags.workflowRequired;
    const workflowHttp422 = !res.ok && res.status === 422;
    const workflowSkipReason = workflowHttp422
      ? `${wfError ?? "Workflow enrollment rejected."} — ${workflowDirectApiSkipDetail(ghlLocationId)}`
      : wfError;
    if (!res.ok) {
      const msg = workflowSkipReason ?? "Workflow start failed after contact was created.";
      if (workflowOptional) warnings.push(msg);
      else errors.push(msg);
    }
    const workflowStatus = res.ok
      ? "succeeded"
      : workflowOptional && workflowHttp422
        ? "skipped"
        : workflowOptional
          ? "optional_failed"
          : "failed";
    pushOutcome({
      stepType: "start_workflow",
      deliveryPlanStepId: findPlanStepId(ctx, "start_workflow"),
      status: workflowStatus,
      targetSystem: "ghl",
      targetId: wfPreview.workflowId,
      externalId: contactIdGhl,
      errorCode: res.ok ? null : `http_${res.status || "transport"}`,
      errorSummary: res.ok ? null : workflowSkipReason,
      warnings:
        !res.ok && workflowOptional
          ? [
              workflowHttp422
                ? "Workflow skipped — direct API enrollment not confirmed for this workflow."
                : "Optional workflow start failed.",
            ]
          : [],
      requestRedactedJson: res.redactedRequest as Prisma.InputJsonValue,
      responseRedactedJson: {
        ...(res.redactedResponse ?? {}),
        externalCallExecuted: true,
        workflowStarted: res.ok,
        workflowTriggerMode: "direct_api",
      } as Prisma.InputJsonValue,
      startedAt,
      completedAt: new Date(),
      externalCallExecuted: true,
    });
  } else {
    pushOutcome({
      stepType: "start_workflow",
      deliveryPlanStepId: findPlanStepId(ctx, "start_workflow"),
      status: "skipped",
      targetSystem: "ghl",
      targetId: null,
      externalId: null,
      errorCode: null,
      errorSummary: "Workflow not configured for this rule.",
      warnings: [],
      requestRedactedJson: null,
      responseRedactedJson: { externalCallExecuted: false } as Prisma.InputJsonValue,
      startedAt: new Date(),
      completedAt: new Date(),
      externalCallExecuted: false,
    });
  }

  // write_backup_sheet — blocked in Phase 4I
  pushOutcome({
    stepType: "write_backup_sheet",
    deliveryPlanStepId: findPlanStepId(ctx, "write_backup_sheet"),
    status: "blocked",
    targetSystem: "google_sheets",
    targetId: null,
    externalId: null,
    errorCode: "phase_4i_not_enabled",
    errorSummary: "Google Sheet delivery not enabled in Phase 4I.",
    warnings: [],
    requestRedactedJson: null,
    responseRedactedJson: { externalCallExecuted: false } as Prisma.InputJsonValue,
    startedAt: new Date(),
    completedAt: new Date(),
    externalCallExecuted: false,
  });

  const requiredPathComplete = isRequiredDeliveryPathComplete(
    stepOutcomes,
    opportunityConfigured
  );
  const runStatus = deriveLiveCanaryRunStatus({
    stepOutcomes,
    flags: stepFlags,
    contactIdGhl,
    opportunityConfigured,
  });

  if (runStatus === "succeeded" || runStatus === "partial_success") {
    await emitLifecycle("lead_delivered", contactIdGhl);
  } else {
    await emitLifecycle("delivery_failed", contactIdGhl);
  }

  const summary = liveCanaryRunSummaryForStatus(runStatus, requiredPathComplete);

  return {
    contactIdGhl,
    opportunityIdGhl,
    workflowStarted,
    stepOutcomes,
    runStatus,
    summary,
    errors,
    warnings,
  };
}

function previewEmail(ctx: GhlAdapterPlanContext): string {
  return ctx.plan.sourceEmail?.trim() ?? "";
}

function previewPhone(ctx: GhlAdapterPlanContext): string {
  return ctx.plan.sourcePhoneE164?.trim() ?? "";
}
