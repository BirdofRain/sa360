import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";
import {
  buildAssignOwnerRequest,
  buildContactUpsertRequest,
  buildCustomFieldStampRequest,
  buildLiveCanaryCustomFieldsMap,
  buildOpportunityRequest,
  buildTagRequest,
  buildWorkflowStartRequest,
} from "./ghl-delivery-request-builders.js";
import {
  buildCustomFieldsForPutFromMap,
  extractContactIdFromGhlResponse,
  extractOpportunityIdFromGhlResponse,
  getGhlLiveTransportCustomFieldIdMap,
  ghlLiveJson,
  type GhlLiveHttpDeps,
} from "./ghl-live-transport.js";
import { saveLifecycleEvent } from "../event-service.js";
import type { LifecycleEventNameInternal } from "../../schemas/lifecycle-event-names.js";

export type LiveCanaryStepOutcome = {
  stepOrder: number;
  stepType: string;
  deliveryPlanStepId: string | null;
  status: "succeeded" | "failed" | "skipped" | "blocked";
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
  const stepOutcomes: LiveCanaryStepOutcome[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let contactIdGhl: string | null = null;
  let opportunityIdGhl: string | null = null;
  let workflowStarted = false;
  let order = 1;
  let contactFailed = false;

  const pushOutcome = (outcome: Omit<LiveCanaryStepOutcome, "stepOrder"> & { stepOrder?: number }) => {
    stepOutcomes.push({ stepOrder: outcome.stepOrder ?? order++, ...outcome });
  };

  await emitLifecycle("lead_delivery_started");

  // create_or_update_contact
  {
    const startedAt = new Date();
    const preview = buildContactUpsertRequest(ctx, customFields);
    const res = await ghlLiveJson(deps, preview.method, preview.path, {
      body: { locationId: preview.locationId, ...preview.body },
    });
    contactIdGhl = extractContactIdFromGhlResponse(res.json);
    const ok = res.ok && Boolean(contactIdGhl);
    if (!ok) {
      contactFailed = true;
      errors.push("Contact upsert failed.");
    }
    pushOutcome({
      stepType: "create_or_update_contact",
      deliveryPlanStepId: findPlanStepId(ctx, "create_or_update_contact"),
      status: ok ? "succeeded" : "failed",
      targetSystem: "ghl",
      targetId: preview.locationId,
      externalId: contactIdGhl,
      errorCode: ok ? null : `http_${res.status || "transport"}`,
      errorSummary: ok ? null : res.text.slice(0, 240),
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
    const idMap = getGhlLiveTransportCustomFieldIdMap();
    const mapped = buildCustomFieldsForPutFromMap(idMap, stamp.customFields);
    let ok = true;
    let resStatus = 200;
    let redactedResponse: Record<string, unknown> = { externalCallExecuted: true };

    if (mapped.length === 0) {
      warnings.push("No GHL custom field IDs configured; field stamp skipped.");
      pushOutcome({
        stepType: "stamp_custom_fields",
        deliveryPlanStepId: findPlanStepId(ctx, "stamp_custom_fields"),
        status: "skipped",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode: null,
        errorSummary: "GHL_SA360_CUSTOM_FIELD_IDS_JSON not configured for stamp step.",
        warnings: ["Custom field ID map empty."],
        requestRedactedJson: { note: "skipped_no_field_map" } as Prisma.InputJsonValue,
        responseRedactedJson: redactedResponse as Prisma.InputJsonValue,
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    } else if (contactIdGhl) {
      const getRes = await ghlLiveJson(
        deps,
        "GET",
        `/contacts/${encodeURIComponent(contactIdGhl)}`,
        { query: { locationId: stamp.locationId }, allowRetry: true }
      );
      const contact =
        getRes.json && typeof getRes.json === "object" && !Array.isArray(getRes.json)
          ? ((getRes.json as Record<string, unknown>).contact as Record<string, unknown> | undefined)
          : undefined;
      const putBody: Record<string, unknown> = {
        locationId: stamp.locationId,
        firstName: contact?.firstName ?? "",
        lastName: contact?.lastName ?? "",
        email: contact?.email ?? previewEmail(ctx),
        phone: contact?.phone ?? previewPhone(ctx),
        customFields: mapped,
      };
      const putRes = await ghlLiveJson(deps, "PUT", `/contacts/${encodeURIComponent(contactIdGhl)}`, {
        body: putBody,
      });
      ok = putRes.ok;
      resStatus = putRes.status;
      redactedResponse = { ...(putRes.redactedResponse ?? {}), externalCallExecuted: true };
      if (!ok) {
        errors.push("Custom field stamp failed after contact was created.");
      }
      pushOutcome({
        stepType: "stamp_custom_fields",
        deliveryPlanStepId: findPlanStepId(ctx, "stamp_custom_fields"),
        status: ok ? "succeeded" : "failed",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode: ok ? null : `http_${resStatus || "transport"}`,
        errorSummary: ok ? null : putRes.text.slice(0, 240),
        warnings: [],
        requestRedactedJson: putRes.redactedRequest as Prisma.InputJsonValue,
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
      { body: { tags: tagsPreview.tags } }
    );
    const ok = res.ok;
    if (!ok) warnings.push("Tag add failed after contact was created.");
    pushOutcome({
      stepType: "add_tags",
      deliveryPlanStepId: findPlanStepId(ctx, "add_tags"),
      status: ok ? "succeeded" : "failed",
      targetSystem: "ghl",
      targetId: contactIdGhl,
      externalId: null,
      errorCode: ok ? null : `http_${res.status || "transport"}`,
      errorSummary: ok ? null : res.text.slice(0, 240),
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
  if (oppPreview && contactIdGhl) {
    const startedAt = new Date();
    const body = {
      ...oppPreview.body,
      contactId: contactIdGhl,
      locationId: oppPreview.locationId,
    };
    const res = await ghlLiveJson(deps, oppPreview.method, oppPreview.path, { body });
    opportunityIdGhl = extractOpportunityIdFromGhlResponse(res.json);
    const ok = res.ok;
    if (!ok) warnings.push("Opportunity creation failed after contact was created.");
    pushOutcome({
      stepType: "create_or_update_opportunity",
      deliveryPlanStepId: findPlanStepId(ctx, "create_or_update_opportunity"),
      status: ok ? "succeeded" : "failed",
      targetSystem: "ghl",
      targetId: oppPreview.locationId,
      externalId: opportunityIdGhl,
      errorCode: ok ? null : `http_${res.status || "transport"}`,
      errorSummary: ok ? null : res.text.slice(0, 240),
      warnings: ok ? [] : ["Non-fatal opportunity failure."],
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
    });
    const ok = res.ok;
    if (!ok) warnings.push("Owner assignment failed after contact was created.");
    pushOutcome({
      stepType: "assign_owner",
      deliveryPlanStepId: findPlanStepId(ctx, "assign_owner"),
      status: ok ? "succeeded" : "failed",
      targetSystem: "ghl",
      targetId: ownerPreview.assignedTo,
      externalId: contactIdGhl,
      errorCode: ok ? null : `http_${res.status || "transport"}`,
      errorSummary: ok ? null : res.text.slice(0, 240),
      warnings: ok ? [] : ["Non-fatal owner assignment failure."],
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
      errorSummary: "Owner assignment not configured.",
      warnings: [],
      requestRedactedJson: null,
      responseRedactedJson: { externalCallExecuted: false } as Prisma.InputJsonValue,
      startedAt: new Date(),
      completedAt: new Date(),
      externalCallExecuted: false,
    });
  }

  // start_workflow
  const wfPreview = buildWorkflowStartRequest(ctx);
  if (wfPreview && contactIdGhl) {
    const startedAt = new Date();
    const path = `/contacts/${encodeURIComponent(contactIdGhl)}/workflow/${encodeURIComponent(wfPreview.workflowId)}`;
    const res = await ghlLiveJson(deps, wfPreview.method, path, {
      body: { locationId: wfPreview.locationId },
    });
    workflowStarted = res.ok;
    if (!res.ok) {
      errors.push("Workflow start failed after contact was created.");
    }
    pushOutcome({
      stepType: "start_workflow",
      deliveryPlanStepId: findPlanStepId(ctx, "start_workflow"),
      status: res.ok ? "succeeded" : "failed",
      targetSystem: "ghl",
      targetId: wfPreview.workflowId,
      externalId: contactIdGhl,
      errorCode: res.ok ? null : `http_${res.status || "transport"}`,
      errorSummary: res.ok ? null : res.text.slice(0, 240),
      warnings: res.ok ? [] : ["Workflow start failure may leave contact without automation."],
      requestRedactedJson: res.redactedRequest as Prisma.InputJsonValue,
      responseRedactedJson: {
        ...(res.redactedResponse ?? {}),
        externalCallExecuted: true,
        workflowStarted: res.ok,
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

  const hasFailure = stepOutcomes.some(
    (s) => s.status === "failed" && s.stepType !== "write_backup_sheet"
  );
  const stampFailed = stepOutcomes.some(
    (s) => s.stepType === "stamp_custom_fields" && s.status === "failed"
  );
  const wfFailed = stepOutcomes.some((s) => s.stepType === "start_workflow" && s.status === "failed");

  let runStatus: LiveCanaryExecutionResult["runStatus"] = "succeeded";
  if (hasFailure || stampFailed || wfFailed) {
    runStatus = contactIdGhl ? "partial_success" : "failed";
  }
  if (errors.length > 0 && contactIdGhl) {
    runStatus = "partial_success";
  }

  if (runStatus === "succeeded" || runStatus === "partial_success") {
    await emitLifecycle("lead_delivered", contactIdGhl);
  } else {
    await emitLifecycle("delivery_failed", contactIdGhl);
  }

  const summary =
    runStatus === "succeeded"
      ? "Live canary delivery completed successfully."
      : runStatus === "partial_success"
        ? "Live canary partially succeeded — review step errors and GHL subaccount before retry."
        : "Live canary delivery failed.";

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
