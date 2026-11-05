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
  isOpportunityDeliveryExpected,
  isValidGhlAssignedUserId,
  validateLiveOpportunityPreflight,
} from "./ghl-delivery-request-builders.js";
import {
  buildCustomFieldStampReport,
  formatCustomFieldStampWarning,
} from "./ghl-custom-field-stamp.report.js";
import {
  auditSa360FieldMappingAgainstDiscovery,
  parseSa360CustomFieldIdMapJson,
  resolveAndAssessSa360FieldMapping,
  resolveSa360CustomFieldKeyMap,
} from "../sa360-custom-field-mapping.service.js";
import { parseSa360CustomFieldOptionMapJson } from "../sa360-custom-field-option-mapping.service.js";
import {
  buildTypedCustomFieldStampPlan,
  resolveCustomFieldStampStepStatus,
} from "./ghl-custom-field-stamp-plan.js";
import {
  extractContactIdFromGhlResponse,
  extractOpportunityIdFromGhlResponse,
  formatCustomFieldStampFailureDetail,
  formatGhlPutContactFailureDetail,
  ghlLiveJson,
  parseGhlApiErrorSummary,
  redactGhlPayload,
  summarizeCustomFieldsPutPayload,
  type GhlLiveHttpDeps,
} from "./ghl-live-transport.js";
import {
  resolveWorkflowTriggerMode,
  WORKFLOW_TAG_TRIGGER_DETAIL,
  WORKFLOW_TRIGGER_TAG,
  buildPostDeliveryWorkflowTags,
} from "./ghl-workflow-trigger-mode.js";
import {
  buildSourceAttributeStampPayload,
  buildSourceAttributeStampPlan,
} from "../source-intake/source-attribute-stamp.service.js";
import { parseSourceEnrichmentPolicyJson } from "../source-intake/source-enrichment.service.js";
import { tagsWithoutLiteralVetTrigger } from "./lal-ai-bot1-vet-snapshot.js";
import { saveLifecycleEvent } from "../event-service.js";
import type { LifecycleEventNameInternal } from "../../schemas/lifecycle-event-names.js";
import {
  deriveLiveCanaryRunStatus,
  getLiveCanaryStepRequirementFlags,
  isRequiredDeliveryPathComplete,
  liveCanaryRunSummaryForStatus,
} from "./ghl-live-canary-step-requirements.js";
import {
  classifyRemoteOutcome,
  noteIdFromResponse,
  operationIdempotencyKey,
  partitionRoutingTags,
  planIntakeSummaryNote,
  retryDecision,
  separateDeliveryResults,
  tagModePlan,
  withheldAutomationEntryTags,
  workflowEnrollmentAllowed,
  type VetOperation,
  type VetOperationReceipt,
} from "./vet-ghl-delivery-contract.js";

export type LiveCanaryStepOutcome = {
  stepOrder: number;
  stepType: string;
  deliveryPlanStepId: string | null;
  status: "succeeded" | "failed" | "skipped" | "blocked" | "optional_failed" | "partial_success";
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
  contactResult: "upserted" | "failed" | "replayed" | "ambiguous" | "rejected" | "not_attempted";
  noteResult: "disabled" | "persisted" | "failed" | "ambiguous" | "rejected" | "skipped";
  workflowResult: "enrolled" | "not_enrolled" | "ambiguous" | "rejected" | "skipped" | "blocked" | "replayed";
};

function ghlDeliveryWrite(
  deps: GhlLiveHttpDeps,
  method: string,
  path: string,
  options?: {
    body?: unknown;
    query?: Record<string, string>;
    timeoutMs?: number;
    allowRetry?: boolean;
    locationId?: string | null;
  }
) {
  return ghlLiveJson(deps, method, path, { ...options, allowRetry: false });
}

function withReceipt(
  response: Record<string, unknown> | null | undefined,
  receipt: VetOperationReceipt
): Prisma.InputJsonValue {
  return { ...(response ?? {}), vetOperationReceipt: receipt };
}

const defaultDeps: GhlLiveHttpDeps = { fetch: globalThis.fetch.bind(globalThis) };

function assignedToFromGhlContact(json: unknown): string | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const root = json as Record<string, unknown>;
  const contact =
    root.contact && typeof root.contact === "object" && !Array.isArray(root.contact)
      ? (root.contact as Record<string, unknown>)
      : root;
  const value = contact.assignedTo ?? contact.assignedUserId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

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
    priorReceipts?: VetOperationReceipt[];
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
  const priorReceipts = opts?.priorReceipts ?? [];
  const priorFor = (operation: VetOperation) =>
    priorReceipts.find((receipt) => receipt.operation === operation) ?? null;
  let workflowBlockReason: string | null = null;
  let duplicateTargetsBlocked = false;
  let contactAssignedTo: string | null = null;
  const lalWebform =
    parseSourceEnrichmentPolicyJson(ctx.destinationFieldMapping?.sourceEnrichmentPolicyJson)
      .lalAiBot1VetWebform === true;
  const lalPrimaryUserId = parseSourceEnrichmentPolicyJson(
    ctx.destinationFieldMapping?.sourceEnrichmentPolicyJson
  ).lalAiBot1PrimaryUserId;

  const pushOutcome = (outcome: Omit<LiveCanaryStepOutcome, "stepOrder"> & { stepOrder?: number }) => {
    stepOutcomes.push({ stepOrder: outcome.stepOrder ?? order++, ...outcome });
  };

  await emitLifecycle("lead_delivery_started");

  const contactUpsertPreview = buildContactUpsertRequest(ctx);

  // create_or_update_contact
  {
    const startedAt = new Date();
    const preview = contactUpsertPreview;
    const prior = priorFor("contact");
    const decision = retryDecision(prior);
    if (decision === "skip_completed" && prior?.externalId) {
      contactIdGhl = prior.externalId;
      pushOutcome({
        stepType: "create_or_update_contact",
        deliveryPlanStepId: findPlanStepId(ctx, "create_or_update_contact"),
        status: "succeeded",
        targetSystem: "ghl",
        targetId: preview.locationId,
        externalId: contactIdGhl,
        errorCode: null,
        errorSummary: null,
        warnings: ["Completed contact upsert was not repeated."],
        requestRedactedJson: null,
        responseRedactedJson: withReceipt(
          { externalCallExecuted: false, replayedFromReceipt: true, contactIdGhl },
          prior
        ),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    } else if (decision === "hold_ambiguous" || decision === "hold_rejected") {
      contactFailed = true;
      const summary =
        decision === "hold_ambiguous"
          ? "Contact upsert has an ambiguous remote outcome and was not repeated."
          : "Contact upsert was rejected by GHL and was not repeated.";
      errors.push(summary);
      pushOutcome({
        stepType: "create_or_update_contact",
        deliveryPlanStepId: findPlanStepId(ctx, "create_or_update_contact"),
        status: "failed",
        targetSystem: "ghl",
        targetId: preview.locationId,
        externalId: prior?.externalId ?? null,
        errorCode: decision,
        errorSummary: summary,
        warnings: [],
        requestRedactedJson: null,
        responseRedactedJson: withReceipt(
          { externalCallExecuted: false, replayedFromReceipt: true },
          prior!
        ),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    } else {
      const upsertBody = buildLiveContactUpsertHttpBody(preview);
      const res = await ghlDeliveryWrite(deps, preview.method, preview.path, {
        body: upsertBody,
        locationId: ghlLocationId,
      });
      contactIdGhl = extractContactIdFromGhlResponse(res.json);
      contactAssignedTo = assignedToFromGhlContact(res.json);
      const ok = res.ok && Boolean(contactIdGhl);
      const ghlError = ok ? null : parseGhlApiErrorSummary(res.text, res.json);
      const receiptOutcome = classifyRemoteOutcome({
        attempted: true,
        httpStatus: res.status,
        ok,
        externalId: contactIdGhl,
        requiresExternalId: true,
      });
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
        warnings: receiptOutcome === "ambiguous" ? ["Ambiguous contact upsert outcome."] : [],
        requestRedactedJson: res.redactedRequest as Prisma.InputJsonValue,
        responseRedactedJson: withReceipt(
          {
            ...(res.redactedResponse ?? {}),
            externalCallExecuted: true,
            contactIdGhl,
          },
          {
            operation: "contact",
            idempotencyKey: operationIdempotencyKey(idempotencyKey, "contact"),
            outcome: receiptOutcome,
            externalId: contactIdGhl,
            httpStatus: res.status,
          }
        ),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: true,
      });
    }
  }

  if (contactFailed) {
    await emitLifecycle("delivery_failed", contactIdGhl);
    const separated = separateDeliveryResults(stepOutcomes);
    return {
      contactIdGhl,
      opportunityIdGhl,
      workflowStarted,
      stepOutcomes,
      runStatus: "failed",
      summary: "Contact creation failed; remaining GHL write steps were not executed.",
      errors,
      warnings,
      contactResult: separated.contact,
      noteResult: separated.note,
      workflowResult: separated.workflow,
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
    const keyMap = resolveSa360CustomFieldKeyMap({
      destinationKeyMapJson: ctx.destinationFieldMapping?.sa360CustomFieldKeyMapJson,
      discoveredFields: ctx.destinationFieldMapping?.discoveredCustomFields,
    });
    const mappingAudit =
      ctx.destinationFieldMapping?.discoveredCustomFields?.length &&
      hasDestinationFieldMap
        ? auditSa360FieldMappingAgainstDiscovery(
            fieldMapping.idMap,
            ctx.destinationFieldMapping.discoveredCustomFields
          )
        : [];
    const optionMap = parseSa360CustomFieldOptionMapJson(
      ctx.destinationFieldMapping?.sa360CustomFieldOptionMapJson
    );
    const stampPlan = buildTypedCustomFieldStampPlan({
      idMap: fieldMapping.idMap,
      values: stamp.customFields,
      keyMap,
      optionMap,
      discoveredFields: ctx.destinationFieldMapping?.discoveredCustomFields,
    });
    if (stampPlan.collisions.length > 0) {
      duplicateTargetsBlocked = true;
      const detail = stampPlan.collisions
        .map((collision) => `${collision.logicalKeys.join(" + ")} → ${collision.fieldId}`)
        .join("; ");
      workflowBlockReason = `Duplicate custom field targets block workflow enrollment: ${detail}.`;
      errors.push(workflowBlockReason);
    }
    const stampReport = buildCustomFieldStampReport(
      stamp.customFields,
      fieldMapping.idMap,
      fieldMapping
    );
    const totalStampCount =
      stampPlan.textBatch.apiPayload.length + stampPlan.optionBatch.apiPayload.length;

    if (totalStampCount === 0 && !stampReport.skippedReason) {
      const resolution = resolveCustomFieldStampStepStatus({
        stampRequired: stepFlags.stampRequired,
        textAttempted: false,
        textOk: true,
        optionAttempted: false,
        optionOk: true,
        textBatchCount: 0,
        optionBatchCount: 0,
        skipped: stampPlan.skipped,
        unsatisfiedRequiredCoreFields: stampPlan.unsatisfiedRequiredCoreFields,
        textErrorDetail: null,
        optionErrorDetail: null,
      });
      for (const w of resolution.warnings) warnings.push(w);
      if (resolution.status === "failed") {
        errors.push(resolution.errorSummary ?? "Required custom field stamp failed.");
      }
      pushOutcome({
        stepType: "stamp_custom_fields",
        deliveryPlanStepId: findPlanStepId(ctx, "stamp_custom_fields"),
        status: resolution.status === "skipped" ? "skipped" : resolution.status,
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode: null,
        errorSummary: resolution.errorSummary,
        warnings: resolution.warnings,
        requestRedactedJson: {
          note: totalStampCount === 0 && stampPlan.skipped.length === 0 ? "skipped_no_field_map" : "typed_stamp_plan_empty",
          attemptedTextFields: stampPlan.attemptedTextFields,
          skippedOptionFields: stampPlan.skippedOptionFields,
          skippedFields: stampPlan.skipped.map((s) => ({
            logicalKey: s.logicalKey,
            dataType: s.dataType,
            reason: s.reason,
            message: s.message,
          })),
          logicalKeysToStamp: stampReport.logicalKeysToStamp,
          configuredGhlFieldIds: stampReport.configuredGhlFieldIds,
          mappableKeys: stampReport.mappableKeys,
          unmappedKeys: stampReport.unmappedKeys,
          mappingSource: fieldMapping.source,
        } as Prisma.InputJsonValue,
        responseRedactedJson: { externalCallExecuted: false } as Prisma.InputJsonValue,
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    } else if (stampReport.skippedReason && totalStampCount === 0) {
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
        responseRedactedJson: { externalCallExecuted: true } as Prisma.InputJsonValue,
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    } else if (contactIdGhl) {
      let textOk = true;
      let textResStatus = 200;
      let textRedactedResponse: Record<string, unknown> = { externalCallExecuted: true };
      let textErrorDetail: string | null = null;
      let textPutRes: Awaited<ReturnType<typeof ghlLiveJson>> | null = null;
      const stampPrior = priorFor("custom_fields");
      const stampDecision = retryDecision(stampPrior);
      if (stampDecision === "hold_ambiguous" || stampDecision === "hold_rejected") {
        textOk = false;
        textErrorDetail =
          stampDecision === "hold_ambiguous"
            ? "Custom field write has an ambiguous remote outcome and was not repeated."
            : "Custom field write was rejected and was not repeated.";
        warnings.push(textErrorDetail);
      }

      if (stampDecision === "execute" && stampPlan.textBatch.apiPayload.length > 0) {
        const textShape = summarizeCustomFieldsPutPayload(stampPlan.textBatch);
        textShape.mappingSource = fieldMapping.source;
        textPutRes = await ghlDeliveryWrite(
          deps,
          "PUT",
          `/contacts/${encodeURIComponent(contactIdGhl)}`,
          {
            body: {
              customFields: stampPlan.textBatch.apiPayload,
            },
            locationId: ghlLocationId,
          }
        );
        textOk = textPutRes.ok;
        textResStatus = textPutRes.status;
        textRedactedResponse = {
          ...(textPutRes.redactedResponse ?? {}),
          externalCallExecuted: true,
          stampPhase: "text",
        };
        if (!textOk) {
          textErrorDetail = formatCustomFieldStampFailureDetail({
            ghlError: parseGhlApiErrorSummary(textPutRes.text, textPutRes.json),
            shapeSummary: textShape,
            mappingSource: fieldMapping.source,
            ghlResponseSanitized: redactGhlPayload(textPutRes.json ?? textPutRes.text),
            endpoint: "PUT /contacts/{contactId}",
            bodyKeys: ["customFields"],
          });
        }
      }

      let optionOk = true;
      let optionAttempted = false;
      let optionResStatus = 200;
      let optionRedactedResponse: Record<string, unknown> | null = null;
      let optionErrorDetail: string | null = null;
      let optionPutRes: Awaited<ReturnType<typeof ghlLiveJson>> | null = null;

      if (stampDecision === "execute" && textOk && stampPlan.optionBatch.apiPayload.length > 0) {
        optionAttempted = true;
        const optionShape = summarizeCustomFieldsPutPayload(stampPlan.optionBatch);
        optionShape.mappingSource = fieldMapping.source;
        optionPutRes = await ghlDeliveryWrite(
          deps,
          "PUT",
          `/contacts/${encodeURIComponent(contactIdGhl)}`,
          {
            body: {
              customFields: stampPlan.optionBatch.apiPayload,
            },
            locationId: ghlLocationId,
          }
        );
        optionOk = optionPutRes.ok;
        optionResStatus = optionPutRes.status;
        optionRedactedResponse = {
          ...(optionPutRes.redactedResponse ?? {}),
          externalCallExecuted: true,
          stampPhase: "option",
        };
        if (!optionOk) {
          optionErrorDetail = formatCustomFieldStampFailureDetail({
            ghlError: parseGhlApiErrorSummary(optionPutRes.text, optionPutRes.json),
            shapeSummary: optionShape,
            mappingSource: fieldMapping.source,
            ghlResponseSanitized: redactGhlPayload(optionPutRes.json ?? optionPutRes.text),
            endpoint: "PUT /contacts/{contactId}",
            bodyKeys: ["customFields"],
          });
        }
      }

      const combinedBuild = {
        apiPayload: [...stampPlan.textBatch.apiPayload, ...stampPlan.optionBatch.apiPayload],
        diagnostics: [...stampPlan.textBatch.diagnostics, ...stampPlan.optionBatch.diagnostics],
      };
      const customFieldsShape = summarizeCustomFieldsPutPayload(combinedBuild);
      customFieldsShape.mappingSource = fieldMapping.source;

      const resolution = resolveCustomFieldStampStepStatus({
        stampRequired: stepFlags.stampRequired,
        textAttempted: stampPlan.textBatch.apiPayload.length > 0,
        textOk,
        optionAttempted,
        optionOk,
        textBatchCount: stampPlan.textBatch.apiPayload.length,
        optionBatchCount: stampPlan.optionBatch.apiPayload.length,
        skipped: stampPlan.skipped,
        unsatisfiedRequiredCoreFields: stampPlan.unsatisfiedRequiredCoreFields,
        textErrorDetail,
        optionErrorDetail,
      });

      for (const w of resolution.warnings) warnings.push(w);
      if (resolution.status === "failed") {
        errors.push(resolution.errorSummary ?? "Custom field stamp failed after contact was created.");
      } else if (
        resolution.status === "optional_failed" &&
        resolution.errorSummary
      ) {
        warnings.push(resolution.errorSummary);
      }

      const stampRequestMeta = {
        ...(textPutRes?.redactedRequest && typeof textPutRes.redactedRequest === "object"
          ? textPutRes.redactedRequest
          : optionPutRes?.redactedRequest && typeof optionPutRes.redactedRequest === "object"
            ? optionPutRes.redactedRequest
            : {}),
        customFieldsShape,
        stampPhases: {
          text: {
            count: stampPlan.textBatch.apiPayload.length,
            attemptedFields: stampPlan.attemptedTextFields,
            ok: textOk,
            httpStatus: stampPlan.textBatch.apiPayload.length > 0 ? textResStatus : null,
          },
          option: {
            count: stampPlan.optionBatch.apiPayload.length,
            attemptedFields: stampPlan.optionBatch.diagnostics.map((d) => d.logicalKey),
            ok: optionOk,
            httpStatus: optionAttempted ? optionResStatus : null,
          },
        },
        attemptedTextFields: stampPlan.attemptedTextFields,
        skippedOptionFields: stampPlan.skippedOptionFields,
        skippedFields: stampPlan.skipped.map((s) => ({
          logicalKey: s.logicalKey,
          dataType: s.dataType,
          reason: s.reason,
          message: s.message,
          isCoreRequired: s.isCoreRequired,
        })),
        fieldDiagnostics: combinedBuild.diagnostics.map((d) => ({
          logicalKey: d.logicalKey,
          ghlFieldIdSuffix: d.ghlFieldId.length > 6 ? d.ghlFieldId.slice(-6) : d.ghlFieldId,
          ghlFieldKey: d.ghlFieldKey,
          itemKeys: d.itemKeys,
          valueProperty: d.valueProperty,
          mappingIdentifierType: d.mappingIdentifierType,
          valueType: d.valueType,
          valueLength: d.valueLength,
          dataType: d.dataType ?? null,
        })),
        mappingAudit: mappingAudit.map((row) => ({
          logicalKey: row.logicalKey,
          savedMappedValueSuffix:
            row.savedMappedValue && row.savedMappedValue.length > 6
              ? row.savedMappedValue.slice(-6)
              : row.savedMappedValue,
          ghlFieldIdSuffix:
            row.ghlFieldId && row.ghlFieldId.length > 6
              ? row.ghlFieldId.slice(-6)
              : row.ghlFieldId,
          ghlFieldKey: row.ghlFieldKey,
          ghlFieldName: row.ghlFieldName,
          ghlFieldType: row.ghlFieldType,
          writeIdentifierOk: row.writeIdentifierOk,
          mappingUsesFieldId: row.mappingUsesFieldId,
          mappingUsesFieldKey: row.mappingUsesFieldKey,
          issue: row.issue,
        })),
        logicalKeysStamped: stampReport.mappableKeys,
        configuredGhlFieldIdCount: stampReport.configuredGhlFieldIds.length,
        mappingSource: fieldMapping.source,
        mappingUsesFieldId: true,
        valuePropertyUsed: "field_value",
        putContactBodyKeys: ["customFields"],
      };

      const stampHttpAttempted = Boolean(textPutRes || optionPutRes);
      const stampOutcome = stampHttpAttempted
        ? classifyRemoteOutcome({
            attempted: true,
            httpStatus: textOk ? optionResStatus : textResStatus,
            ok: resolution.status === "succeeded" || resolution.status === "partial_success",
            externalId: null,
            requiresExternalId: false,
          })
        : stampDecision === "skip_completed"
          ? "completed"
          : stampDecision === "hold_rejected"
            ? "rejected"
            : stampDecision === "hold_ambiguous"
              ? "ambiguous"
              : "failed_before_send";
      pushOutcome({
        stepType: "stamp_custom_fields",
        deliveryPlanStepId: findPlanStepId(ctx, "stamp_custom_fields"),
        status:
          stampDecision === "skip_completed"
            ? "succeeded"
            : stampDecision === "hold_ambiguous" || stampDecision === "hold_rejected"
              ? "failed"
              : resolution.status,
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode:
          stampDecision !== "execute"
            ? stampDecision === "skip_completed"
              ? null
              : stampDecision
            : resolution.status === "succeeded" || resolution.status === "partial_success"
              ? null
              : `http_${textOk ? optionResStatus : textResStatus || "transport"}`,
        errorSummary:
          stampDecision === "skip_completed"
            ? null
            : stampDecision === "hold_ambiguous" || stampDecision === "hold_rejected"
              ? textErrorDetail
              : resolution.errorSummary,
        warnings: stampDecision === "skip_completed" ? ["Completed custom field write was not repeated."] : resolution.warnings,
        requestRedactedJson: stampRequestMeta as Prisma.InputJsonValue,
        responseRedactedJson: withReceipt(
          stampPrior && stampDecision !== "execute"
            ? { externalCallExecuted: false, replayedFromReceipt: true }
            : { ...(optionRedactedResponse ?? textRedactedResponse) },
          stampPrior && stampDecision !== "execute"
            ? stampPrior
            : {
                operation: "custom_fields",
                idempotencyKey: operationIdempotencyKey(idempotencyKey, "custom_fields"),
                outcome: stampOutcome,
                externalId: null,
                httpStatus: stampHttpAttempted ? (textOk ? optionResStatus : textResStatus) : null,
              }
        ),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: stampHttpAttempted,
      });
    }
  }

  // stamp_source_attributes (optional — never blocks contact delivery)
  if (contactIdGhl && ctx.sourceEnrichment) {
    const startedAt = new Date();
    const discovered = ctx.destinationFieldMapping?.discoveredCustomFields ?? [];
    const stampPlan = buildSourceAttributeStampPlan({
      sourceAttributes: ctx.sourceEnrichment.sourceAttributes,
      fieldMap: ctx.sourceEnrichment.sourceAttributeFieldMap,
      discoveredFields: discovered,
      ignoredCanonicalKeys: ctx.sourceEnrichment.sourceEnrichmentPolicy.ignoredCanonicalKeys,
      normalizedPayload: ctx.sourceEnrichment.normalizedPayload,
      receivedAt: ctx.sourceEnrichment.receivedAt,
    });
    if (stampPlan.collisions.length > 0) {
      duplicateTargetsBlocked = true;
      const detail = stampPlan.collisions
        .map((collision) => `${collision.canonicalKeys.join(" + ")} → ${collision.fieldName ?? collision.fieldId}`)
        .join("; ");
      workflowBlockReason = `Duplicate custom field targets block workflow enrollment: ${detail}.`;
      errors.push(workflowBlockReason);
    }
    if (stampPlan.unresolvedDeliveryRequired.length > 0) {
      workflowBlockReason =
        workflowBlockReason ??
        `Required source fields were not written: ${stampPlan.unresolvedDeliveryRequired.join(", ")}.`;
    }
    const payload = buildSourceAttributeStampPayload(stampPlan);
    const sourcePrior = priorFor("source_attributes");
    const sourceDecision = retryDecision(sourcePrior);
    if (sourceDecision === "skip_completed") {
      pushOutcome({
        stepType: "stamp_source_attributes",
        deliveryPlanStepId: findPlanStepId(ctx, "stamp_source_attributes"),
        status: "succeeded",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode: null,
        errorSummary: null,
        warnings: ["Completed source-attribute write was not repeated."],
        requestRedactedJson: null,
        responseRedactedJson: withReceipt({ externalCallExecuted: false, replayedFromReceipt: true }, sourcePrior!),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    } else if (sourceDecision === "hold_ambiguous" || sourceDecision === "hold_rejected") {
      pushOutcome({
        stepType: "stamp_source_attributes",
        deliveryPlanStepId: findPlanStepId(ctx, "stamp_source_attributes"),
        status: "failed",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode: sourceDecision,
        errorSummary: "Source-attribute write was not repeated.",
        warnings: [],
        requestRedactedJson: null,
        responseRedactedJson: withReceipt({ externalCallExecuted: false, replayedFromReceipt: true }, sourcePrior!),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    } else if (stampPlan.collisions.length > 0 && payload.apiPayload.length === 0) {
      pushOutcome({
        stepType: "stamp_source_attributes",
        deliveryPlanStepId: findPlanStepId(ctx, "stamp_source_attributes"),
        status: "failed",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode: "duplicate_field_target",
        errorSummary: workflowBlockReason,
        warnings: ["Colliding source fields were omitted and not sent."],
        requestRedactedJson: {
          collisions: stampPlan.collisions,
          missingSourceKeys: stampPlan.missingSourceKeys,
        } as Prisma.InputJsonValue,
        responseRedactedJson: withReceipt(
          { externalCallExecuted: false },
          {
            operation: "source_attributes",
            idempotencyKey: operationIdempotencyKey(idempotencyKey, "source_attributes"),
            outcome: "failed_before_send",
            externalId: null,
            httpStatus: null,
          }
        ),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    } else if (payload.apiPayload.length > 0) {
      const res = await ghlDeliveryWrite(deps, "PUT", `/contacts/${encodeURIComponent(contactIdGhl)}`, {
        body: { customFields: payload.apiPayload },
        locationId: ghlLocationId,
      });
      const ok = res.ok;
      const detail = ok
        ? null
        : parseGhlApiErrorSummary(res.text, res.json) ?? "Source attribute stamp failed.";
      if (!ok && detail) warnings.push(`Source attribute stamp (non-blocking): ${detail}`);
      pushOutcome({
        stepType: "stamp_source_attributes",
        deliveryPlanStepId: findPlanStepId(ctx, "stamp_source_attributes"),
        status: stampPlan.collisions.length > 0 ? "failed" : ok ? "succeeded" : "optional_failed",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode: stampPlan.collisions.length > 0 ? "duplicate_field_target" : ok ? null : `http_${res.status || "transport"}`,
        errorSummary: stampPlan.collisions.length > 0 ? workflowBlockReason : detail,
        warnings: ok ? [] : ["Optional source attribute stamp failed; contact delivery preserved."],
        requestRedactedJson: {
          mappableKeys: stampPlan.mappableKeys,
          unmappedKeys: stampPlan.unmappedKeys,
          missingSourceKeys: stampPlan.missingSourceKeys,
          skippedKeys: stampPlan.skippedKeys,
          collisions: stampPlan.collisions,
          fieldCount: payload.apiPayload.length,
        } as Prisma.InputJsonValue,
        responseRedactedJson: withReceipt(
          {
            ...(res.redactedResponse ?? {}),
            externalCallExecuted: true,
          },
          {
            operation: "source_attributes",
            idempotencyKey: operationIdempotencyKey(idempotencyKey, "source_attributes"),
            outcome: classifyRemoteOutcome({
              attempted: true,
              httpStatus: res.status,
              ok,
              externalId: contactIdGhl,
              requiresExternalId: false,
            }),
            externalId: contactIdGhl,
            httpStatus: res.status,
          }
        ),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: true,
      });
    } else {
      pushOutcome({
        stepType: "stamp_source_attributes",
        deliveryPlanStepId: findPlanStepId(ctx, "stamp_source_attributes"),
        status: "skipped",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode: null,
        errorSummary: "No mapped source attributes to stamp.",
        warnings: [
          ...(stampPlan.unmappedKeys.length
            ? [`Missing mappings: ${stampPlan.unmappedKeys.join(", ")}`]
            : []),
          ...(stampPlan.missingSourceKeys.length
            ? [`Missing source values: ${stampPlan.missingSourceKeys.join(", ")}`]
            : []),
        ],
        requestRedactedJson: {
          unmappedKeys: stampPlan.unmappedKeys,
          missingSourceKeys: stampPlan.missingSourceKeys,
          skippedKeys: stampPlan.skippedKeys,
        } as Prisma.InputJsonValue,
        responseRedactedJson: withReceipt(
          { externalCallExecuted: false },
          {
            operation: "source_attributes",
            idempotencyKey: operationIdempotencyKey(idempotencyKey, "source_attributes"),
            outcome: "skipped",
            externalId: null,
            httpStatus: null,
          }
        ),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    }
  }

  const requiredStamp = stepOutcomes.find((step) => step.stepType === "stamp_custom_fields");
  if (stepFlags.stampRequired && requiredStamp?.status === "failed") {
    workflowBlockReason =
      workflowBlockReason ?? "Workflow enrollment waits until required custom field writes succeed.";
  }

  const notesEnabled =
    ctx.destinationFieldMapping?.intakeSummaryNotesEnabled === true ||
    ctx.sourceEnrichment?.sourceEnrichmentPolicy.intakeSummaryNotesEnabled === true;
  if (contactIdGhl && notesEnabled) {
    const startedAt = new Date();
    const notePlan = planIntakeSummaryNote({
      enabled: true,
      sourceLeadEventId: ctx.plan.sourceLeadUid?.trim() || ctx.plan.id,
      clientAccountId: ctx.plan.destinationClientAccountId,
      firstName: contactUpsertPreview.body.firstName,
      lastName: contactUpsertPreview.body.lastName,
      phone: contactUpsertPreview.body.phone,
      email: contactUpsertPreview.body.email,
      state: contactUpsertPreview.body.state,
      leadType: ctx.plan.nicheKey,
      sourceAttributes: ctx.sourceEnrichment?.sourceAttributes ?? null,
      generatedAt: ctx.sourceEnrichment?.receivedAt ?? null,
      idempotencyKey,
    });
    const notePrior = priorFor("note");
    const noteDecision = retryDecision(notePrior);
    if (noteDecision === "skip_completed") {
      pushOutcome({
        stepType: "write_intake_summary_note",
        deliveryPlanStepId: findPlanStepId(ctx, "write_intake_summary_note"),
        status: "succeeded",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: notePrior?.externalId ?? null,
        errorCode: null,
        errorSummary: null,
        warnings: ["Completed intake-summary note was not repeated."],
        requestRedactedJson: null,
        responseRedactedJson: withReceipt({ externalCallExecuted: false, replayedFromReceipt: true }, notePrior!),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    } else if (noteDecision === "hold_ambiguous" || noteDecision === "hold_rejected") {
      warnings.push("Intake-summary note was not repeated.");
      pushOutcome({
        stepType: "write_intake_summary_note",
        deliveryPlanStepId: findPlanStepId(ctx, "write_intake_summary_note"),
        status: "optional_failed",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: notePrior?.externalId ?? null,
        errorCode: noteDecision,
        errorSummary: "Intake-summary note was not repeated.",
        warnings: [],
        requestRedactedJson: null,
        responseRedactedJson: withReceipt({ externalCallExecuted: false, replayedFromReceipt: true }, notePrior!),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    } else if (!("plan" in notePlan) || !notePlan.plan) {
      pushOutcome({
        stepType: "write_intake_summary_note",
        deliveryPlanStepId: findPlanStepId(ctx, "write_intake_summary_note"),
        status: "skipped",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode: "error" in notePlan ? notePlan.error : "note_unavailable",
        errorSummary: "error" in notePlan ? notePlan.error : "Intake-summary note was not posted.",
        warnings: [],
        requestRedactedJson: null,
        responseRedactedJson: withReceipt(
          { externalCallExecuted: false },
          {
            operation: "note",
            idempotencyKey: operationIdempotencyKey(idempotencyKey, "note", 1),
            outcome: "skipped",
            externalId: null,
            httpStatus: null,
          }
        ),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    } else {
      let noteId: string | null = null;
      let noteOk = true;
      let noteStatus = 200;
      let noteError: string | null = null;
      let noteResponse: Record<string, unknown> = {};
      for (const part of notePlan.plan.parts) {
        const res = await ghlDeliveryWrite(deps, "POST", `/contacts/${encodeURIComponent(contactIdGhl)}/notes`, {
          body: { title: part.title, body: part.body },
          locationId: ghlLocationId,
        });
        noteStatus = res.status;
        noteResponse = { ...(res.redactedResponse ?? {}) };
        noteId = noteIdFromResponse(res.json);
        noteOk = res.ok && Boolean(noteId);
        if (!noteOk) {
          noteError = parseGhlApiErrorSummary(res.text, res.json) ?? "Intake-summary note failed.";
          break;
        }
      }
      const noteOutcome = classifyRemoteOutcome({
        attempted: true,
        httpStatus: noteStatus,
        ok: noteOk,
        externalId: noteId,
        requiresExternalId: true,
      });
      if (!noteOk && noteError) warnings.push(`Intake-summary note (non-blocking): ${noteError}`);
      pushOutcome({
        stepType: "write_intake_summary_note",
        deliveryPlanStepId: findPlanStepId(ctx, "write_intake_summary_note"),
        status: noteOk ? "succeeded" : "optional_failed",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: noteId,
        errorCode: noteOk ? null : `http_${noteStatus || "transport"}`,
        errorSummary: noteError,
        warnings: noteOk ? [] : ["Optional intake-summary note failed; contact delivery preserved."],
        requestRedactedJson: { contract: "sa360_lead_note_v2", parts: notePlan.plan.parts.length } as Prisma.InputJsonValue,
        responseRedactedJson: withReceipt(
          { ...noteResponse, externalCallExecuted: true, noteId },
          {
            operation: "note",
            idempotencyKey: operationIdempotencyKey(idempotencyKey, "note", 1),
            outcome: noteOutcome,
            externalId: noteId,
            httpStatus: noteStatus,
          }
        ),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: true,
      });
    }
  }

  // add_tags — POST adds these tags and does not replace unrelated contact tags.
  // A closed required-write gate drops automation-entry tags. Niche, source, and client tags still post.
  {
    const startedAt = new Date();
    const tagsPreview = buildTagRequest(ctx);
    const blockAutomationEntry = workflowBlockReason !== null;
    const routingTags = lalWebform ? tagsWithoutLiteralVetTrigger(tagsPreview.tags) : tagsPreview.tags;
    const partitioned = partitionRoutingTags(routingTags, blockAutomationEntry);
    const tagPrior = priorFor("tags");
    const tagDecision = retryDecision(tagPrior);
    const withheldOnPrior = withheldAutomationEntryTags(tagPrior);
    const postWithheldOnly =
      tagDecision === "skip_completed" && !blockAutomationEntry && withheldOnPrior.length > 0;
    const tagReceipt = (
      outcome: VetOperationReceipt["outcome"],
      httpStatus: number | null,
      withheld: string[]
    ): VetOperationReceipt => ({
      operation: "tags",
      idempotencyKey: operationIdempotencyKey(idempotencyKey, "tags"),
      outcome,
      externalId: null,
      httpStatus,
      ...(withheld.length > 0 ? { withheldAutomationEntryTags: withheld } : {}),
    });

    if (postWithheldOnly) {
      const res = await ghlDeliveryWrite(
        deps,
        tagsPreview.method,
        `/contacts/${encodeURIComponent(contactIdGhl!)}/tags`,
        { body: { tags: withheldOnPrior }, locationId: ghlLocationId }
      );
      const ok = res.ok;
      const tagError = ok ? null : parseGhlApiErrorSummary(res.text, res.json);
      if (!ok) warnings.push(tagError ?? "Withheld automation-entry tag was not posted.");
      const outcome = classifyRemoteOutcome({
        attempted: true,
        httpStatus: res.status,
        ok,
        externalId: null,
        requiresExternalId: false,
      });
      pushOutcome({
        stepType: "add_tags",
        deliveryPlanStepId: findPlanStepId(ctx, "add_tags"),
        status: ok ? "succeeded" : "failed",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode: ok ? null : `http_${res.status || "transport"}`,
        errorSummary: ok ? null : tagError,
        warnings: ok
          ? ["Posted the automation-entry tag withheld until required writes succeeded."]
          : ["Automation-entry tag was not confirmed and was not repeated."],
        requestRedactedJson: {
          ...(res.redactedRequest ?? {}),
          tagWrite: "add_only",
          replacesExistingTags: false,
          tags: withheldOnPrior,
        } as Prisma.InputJsonValue,
        responseRedactedJson: withReceipt(
          {
            ...(res.redactedResponse ?? {}),
            externalCallExecuted: true,
            tagWrite: "add_only",
            replacesExistingTags: false,
          },
          tagReceipt(outcome, res.status, [])
        ),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: true,
      });
    } else if (tagDecision !== "execute") {
      pushOutcome({
        stepType: "add_tags",
        deliveryPlanStepId: findPlanStepId(ctx, "add_tags"),
        status: tagDecision === "skip_completed" ? "succeeded" : "failed",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode: tagDecision === "skip_completed" ? null : tagDecision,
        errorSummary: tagDecision === "skip_completed" ? null : "Tag add was not repeated.",
        warnings: ["Existing contact tags were left unchanged."],
        requestRedactedJson: { tagWrite: "add_only", replacesExistingTags: false } as Prisma.InputJsonValue,
        responseRedactedJson: withReceipt(
          { externalCallExecuted: false, replayedFromReceipt: true, tagWrite: "add_only", replacesExistingTags: false },
          tagPrior!
        ),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    } else if (partitioned.tags.length === 0) {
      pushOutcome({
        stepType: "add_tags",
        deliveryPlanStepId: findPlanStepId(ctx, "add_tags"),
        status: "succeeded",
        targetSystem: "ghl",
        targetId: contactIdGhl,
        externalId: null,
        errorCode: null,
        errorSummary: null,
        warnings: ["Automation-entry tags were withheld because required writes blocked enrollment."],
        requestRedactedJson: {
          tagWrite: "add_only",
          replacesExistingTags: false,
          withheldAutomationEntryTags: partitioned.withheldAutomationEntryTags,
        } as Prisma.InputJsonValue,
        responseRedactedJson: withReceipt(
          { externalCallExecuted: false, tagWrite: "add_only", replacesExistingTags: false },
          tagReceipt("completed", null, partitioned.withheldAutomationEntryTags)
        ),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: false,
      });
    } else {
      const res = await ghlDeliveryWrite(
        deps,
        tagsPreview.method,
        `/contacts/${encodeURIComponent(contactIdGhl!)}/tags`,
        { body: { tags: partitioned.tags }, locationId: ghlLocationId }
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
        warnings: [
          ...(ok ? [] : ["Non-fatal tag failure."]),
          ...(partitioned.withheldAutomationEntryTags.length > 0
            ? ["Automation-entry tags were withheld because required writes blocked enrollment."]
            : []),
        ],
        requestRedactedJson: {
          ...(res.redactedRequest ?? {}),
          tagWrite: "add_only",
          replacesExistingTags: false,
          ...(partitioned.withheldAutomationEntryTags.length > 0
            ? { withheldAutomationEntryTags: partitioned.withheldAutomationEntryTags }
            : {}),
        } as Prisma.InputJsonValue,
        responseRedactedJson: withReceipt(
          {
            ...(res.redactedResponse ?? {}),
            externalCallExecuted: true,
            tagWrite: "add_only",
            replacesExistingTags: false,
          },
          tagReceipt(
            classifyRemoteOutcome({
              attempted: true,
              httpStatus: res.status,
              ok,
              externalId: null,
              requiresExternalId: false,
            }),
            res.status,
            partitioned.withheldAutomationEntryTags
          )
        ),
        startedAt,
        completedAt: new Date(),
        externalCallExecuted: true,
      });
    }
  }

  // create_or_update_opportunity
  const oppPreview = buildOpportunityRequest(ctx);
  const oppBody = contactIdGhl ? buildLiveOpportunityHttpBody(ctx, contactIdGhl) : null;
  const snapshotOwnsInitialOpportunity = lalWebform;
  opportunityConfigured = !snapshotOwnsInitialOpportunity && Boolean(oppPreview && oppBody);
  const opportunityExpected =
    !snapshotOwnsInitialOpportunity && isOpportunityDeliveryExpected(ctx);
  const oppPreflight = opportunityExpected
    ? validateLiveOpportunityPreflight(ctx, contactIdGhl)
    : { ok: true, issues: [], missingConfig: [] };

  if (opportunityExpected && !oppPreflight.ok) {
    // Block before any external write — opportunity config is missing/invalid.
    opportunityFailed = true;
    opportunityConfigured = true; // ensure the run reflects the blocked required step
    const detail = `Opportunity delivery config incomplete: ${oppPreflight.issues.join("; ")}`;
    errors.push(detail);
    pushOutcome({
      stepType: "create_or_update_opportunity",
      deliveryPlanStepId: findPlanStepId(ctx, "create_or_update_opportunity"),
      status: "failed",
      targetSystem: "ghl",
      targetId: ghlLocationId,
      externalId: null,
      errorCode: "opportunity_preflight_blocked",
      errorSummary: detail,
      warnings: ["Opportunity create blocked before external write — fix destination delivery config."],
      requestRedactedJson: {
        note: "opportunity_preflight_blocked",
        attemptedExternalWrite: false,
        issues: oppPreflight.issues,
        missingConfig: oppPreflight.missingConfig,
      } as Prisma.InputJsonValue,
      responseRedactedJson: {
        externalCallExecuted: false,
        preflightBlocked: true,
        missingConfig: oppPreflight.missingConfig,
      } as Prisma.InputJsonValue,
      startedAt: new Date(),
      completedAt: new Date(),
      externalCallExecuted: false,
    });
  } else if (!snapshotOwnsInitialOpportunity && oppPreview && oppBody) {
    const startedAt = new Date();
    const res = await ghlDeliveryWrite(deps, oppPreview.method, oppPreview.path, {
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
      errorSummary: snapshotOwnsInitialOpportunity
        ? "Workflow 8 creates the initial Veteran / New Lead opportunity."
        : "Opportunity not configured for this rule.",
      warnings: [],
      requestRedactedJson: null,
      responseRedactedJson: { externalCallExecuted: false } as Prisma.InputJsonValue,
      startedAt: new Date(),
      completedAt: new Date(),
      externalCallExecuted: false,
    });
  }

  // assign_owner — before workflow enrollment so #8 can notify that owner.
  const explicitOwner = isValidGhlAssignedUserId(ctx.rule?.defaultAssignedUserIdGhl)
    ? ctx.rule.defaultAssignedUserIdGhl.trim()
    : null;
  const fallbackPrimary =
    lalWebform && isValidGhlAssignedUserId(lalPrimaryUserId) ? lalPrimaryUserId.trim() : null;
  const ownerId = explicitOwner ?? fallbackPrimary ?? buildAssignOwnerRequest(ctx)?.assignedTo ?? null;
  if (lalWebform && contactIdGhl && contactAssignedTo) {
    pushOutcome({
      stepType: "assign_owner",
      deliveryPlanStepId: findPlanStepId(ctx, "assign_owner"),
      status: "skipped",
      targetSystem: "ghl",
      targetId: contactAssignedTo,
      externalId: contactIdGhl,
      errorCode: null,
      errorSummary: "Existing contact owner was left unchanged.",
      warnings: ["Manual owner reassignment was preserved."],
      requestRedactedJson: null,
      responseRedactedJson: { externalCallExecuted: false, assignedTo: contactAssignedTo } as Prisma.InputJsonValue,
      startedAt: new Date(),
      completedAt: new Date(),
      externalCallExecuted: false,
    });
  } else if (ownerId && contactIdGhl) {
    const startedAt = new Date();
    const res = await ghlDeliveryWrite(deps, "PUT", `/contacts/${encodeURIComponent(contactIdGhl)}`, {
      body: { assignedTo: ownerId },
      locationId: ghlLocationId,
    });
    const ok = res.ok;
    const ownerError = ok
      ? null
      : formatGhlPutContactFailureDetail({
          ghlError: parseGhlApiErrorSummary(res.text, res.json),
          endpoint: "PUT /contacts/{contactId}",
          bodyKeys: ["assignedTo"],
          ghlResponseSanitized: redactGhlPayload(res.json ?? res.text),
        });
    const ownerOptional = !stepFlags.ownerRequired;
    if (!ok) {
      const msg =
        ownerError ??
        `Configured owner ID may be invalid for this location (${ownerId}).`;
      if (ownerOptional) warnings.push(msg);
      else errors.push(msg);
    }
    pushOutcome({
      stepType: "assign_owner",
      deliveryPlanStepId: findPlanStepId(ctx, "assign_owner"),
      status: ok ? "succeeded" : ownerOptional ? "optional_failed" : "failed",
      targetSystem: "ghl",
      targetId: ownerId,
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
  const workflowPrior = priorFor("workflow");
  const workflowDecision = retryDecision(workflowPrior);
  const enrollment = workflowEnrollmentAllowed({
    contactCompleted: Boolean(contactIdGhl) && !contactFailed,
    requiredCustomFieldStampFailed: stepFlags.stampRequired && requiredStamp?.status === "failed",
    collisions: duplicateTargetsBlocked ? [{ fieldId: "duplicate", fieldName: null, canonicalKeys: [] }] : [],
    unresolvedDeliveryRequired: workflowBlockReason?.startsWith("Required source fields") ? ["required"] : [],
  });
  if (!enrollment.allowed && !workflowBlockReason) workflowBlockReason = enrollment.reason;
  if (workflowDecision === "skip_completed") {
    workflowStarted = workflowTriggerMode === "direct_api";
    pushOutcome({
      stepType: "start_workflow",
      deliveryPlanStepId: findPlanStepId(ctx, "start_workflow"),
      status: "succeeded",
      targetSystem: "ghl",
      targetId: wfPreview?.workflowId ?? WORKFLOW_TRIGGER_TAG,
      externalId: contactIdGhl,
      errorCode: null,
      errorSummary: null,
      warnings: ["Completed workflow entry was not repeated."],
      requestRedactedJson: null,
      responseRedactedJson: withReceipt(
        { externalCallExecuted: false, replayedFromReceipt: true, workflowStarted: true },
        workflowPrior!
      ),
      startedAt: new Date(),
      completedAt: new Date(),
      externalCallExecuted: false,
    });
  } else if (workflowDecision === "hold_ambiguous" || workflowDecision === "hold_rejected") {
    const summary =
      workflowDecision === "hold_ambiguous"
        ? "Workflow entry has an ambiguous remote outcome and was not repeated."
        : "Workflow entry was rejected and was not repeated.";
    warnings.push(summary);
    pushOutcome({
      stepType: "start_workflow",
      deliveryPlanStepId: findPlanStepId(ctx, "start_workflow"),
      status: stepFlags.workflowRequired ? "failed" : "optional_failed",
      targetSystem: "ghl",
      targetId: wfPreview?.workflowId ?? null,
      externalId: contactIdGhl,
      errorCode: workflowDecision,
      errorSummary: summary,
      warnings: [summary],
      requestRedactedJson: null,
      responseRedactedJson: withReceipt({ externalCallExecuted: false, replayedFromReceipt: true }, workflowPrior!),
      startedAt: new Date(),
      completedAt: new Date(),
      externalCallExecuted: false,
    });
  } else if (workflowBlockReason && workflowTriggerMode !== "none") {
    warnings.push(workflowBlockReason);
    pushOutcome({
      stepType: "start_workflow",
      deliveryPlanStepId: findPlanStepId(ctx, "start_workflow"),
      status: "skipped",
      targetSystem: "ghl",
      targetId: wfPreview?.workflowId ?? WORKFLOW_TRIGGER_TAG,
      externalId: contactIdGhl,
      errorCode: "workflow_blocked",
      errorSummary: workflowBlockReason,
      warnings: [workflowBlockReason],
      requestRedactedJson: null,
      responseRedactedJson: withReceipt(
        { externalCallExecuted: false, workflowBlocked: true },
        {
          operation: "workflow",
          idempotencyKey: operationIdempotencyKey(idempotencyKey, "workflow"),
          outcome: "failed_before_send",
          externalId: null,
          httpStatus: null,
        }
      ),
      startedAt: new Date(),
      completedAt: new Date(),
      externalCallExecuted: false,
    });
  } else if (workflowTriggerMode === "none") {
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
    const enrichment = ctx.sourceEnrichment;
    const workflowTags = tagModePlan({
      mode: "tag_trigger",
      extraTags: buildPostDeliveryWorkflowTags({
        automationReadiness: enrichment?.automationReadiness ?? "limited",
        enrichmentStatus: enrichment?.enrichmentStatus ?? "none",
        hasUnmappedFields: (enrichment?.unmappedSourceFieldKeys.length ?? 0) > 0,
      }),
    }).tagsToAdd;
    const res = await ghlDeliveryWrite(
      deps,
      "POST",
      `/contacts/${encodeURIComponent(contactIdGhl)}/tags`,
      { body: { tags: workflowTags }, locationId: ghlLocationId }
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
      requestRedactedJson: {
        ...(res.redactedRequest ?? {}),
        tagWrite: "add_only",
        replacesExistingTags: false,
        tags: workflowTags,
      } as Prisma.InputJsonValue,
      responseRedactedJson: withReceipt(
        {
          ...(res.redactedResponse ?? {}),
          externalCallExecuted: true,
          workflowTriggerMode: "tag_trigger",
          tagWrite: "add_only",
          replacesExistingTags: false,
        },
        {
          operation: "workflow",
          idempotencyKey: operationIdempotencyKey(idempotencyKey, "workflow"),
          outcome: classifyRemoteOutcome({
            attempted: true,
            httpStatus: res.status,
            ok,
            externalId: contactIdGhl,
            requiresExternalId: false,
          }),
          externalId: contactIdGhl,
          httpStatus: res.status,
        }
      ),
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
    // Enrollment is scoped by the contact. GHL rejects a locationId property on this body.
    const res = await ghlDeliveryWrite(deps, wfPreview.method, path, {
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
      responseRedactedJson: withReceipt(
        {
          ...(res.redactedResponse ?? {}),
          externalCallExecuted: true,
          workflowStarted: res.ok,
          workflowTriggerMode: "direct_api",
        },
        {
          operation: "workflow",
          idempotencyKey: operationIdempotencyKey(idempotencyKey, "workflow"),
          outcome: classifyRemoteOutcome({
            attempted: true,
            httpStatus: res.status,
            ok: res.ok,
            externalId: contactIdGhl,
            requiresExternalId: false,
          }),
          externalId: contactIdGhl,
          httpStatus: res.status,
        }
      ),
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
  let runStatus = deriveLiveCanaryRunStatus({
    stepOutcomes,
    flags: stepFlags,
    contactIdGhl,
    opportunityConfigured,
  });
  if (duplicateTargetsBlocked) runStatus = "failed";

  if (runStatus === "succeeded" || runStatus === "partial_success") {
    await emitLifecycle("lead_delivered", contactIdGhl);
  } else {
    await emitLifecycle("delivery_failed", contactIdGhl);
  }

  const summary = duplicateTargetsBlocked
    ? workflowBlockReason ?? "Duplicate custom field targets blocked workflow enrollment."
    : liveCanaryRunSummaryForStatus(runStatus, requiredPathComplete);
  const separated = separateDeliveryResults(stepOutcomes);

  return {
    contactIdGhl,
    opportunityIdGhl,
    workflowStarted,
    stepOutcomes,
    runStatus,
    summary,
    errors,
    warnings,
    contactResult: separated.contact,
    noteResult: separated.note,
    workflowResult: separated.workflow,
  };
}

function previewEmail(ctx: GhlAdapterPlanContext): string {
  return ctx.plan.sourceEmail?.trim() ?? "";
}

function previewPhone(ctx: GhlAdapterPlanContext): string {
  return ctx.plan.sourcePhoneE164?.trim() ?? "";
}
