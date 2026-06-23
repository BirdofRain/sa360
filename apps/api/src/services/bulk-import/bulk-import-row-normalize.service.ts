import type { BulkLeadImportRowDuplicateStatus, BulkLeadImportRowValidationStatus, Prisma, SourceLeadEventStatus } from "@prisma/client";
import type { z } from "zod";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import {
  createSourceLeadEvent,
  updateSourceLeadEvent,
} from "../../repositories/source-lead-event.repository.js";
import {
  attachSourceAttributesToLifecyclePayload,
  runSourceEnrichmentPipeline,
} from "../source-intake/source-enrichment-pipeline.service.js";
import { classifyDuplicateStatus } from "./bulk-import-duplicate.service.js";
import { evaluateRowEligibility } from "./bulk-import-eligibility.service.js";
import {
  normalizeBulkImportRowToLifecycle,
  resolveBulkImportLeadId,
} from "./bulk-import-normalizer.service.js";
import {
  buildImportRouteKey,
  buildManualImportRoutingResult,
  type BulkImportNormalizationOptions,
  type ImportDuplicateCandidate,
  type ImportFieldMapping,
} from "./bulk-import.types.js";
import { listMissingRequiredMappings } from "./csv-import-mapping.service.js";
import { resolveRoutingMasterClientAccountIdForDestination } from "./bulk-import-routing-master.service.js";

function asOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return undefined;
}

export type SanitizedSchemaIssue = {
  path: string;
  code: string;
  message: string;
};

export function sanitizeZodIssues(issues: z.ZodIssue[]): SanitizedSchemaIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    code: issue.code,
    message: issue.message.slice(0, 200),
  }));
}

export type NormalizeBulkImportRowSuccess = {
  ok: true;
  sourceLeadEventId: string;
  sourceLeadId: string;
  sourceLeadIdGenerated: boolean;
  normalizedPhone: string | null;
  normalizedEmail: string | null;
  validationStatus: BulkLeadImportRowValidationStatus;
  duplicateStatus: BulkLeadImportRowDuplicateStatus;
  blockerReasonsJson: Prisma.InputJsonValue;
  duplicateCandidatesJson: Prisma.InputJsonValue;
  errorSummary: null;
};

export type NormalizeBulkImportRowFailure = {
  ok: false;
  error: "lifecycle_schema_invalid" | "source_event_persistence_failed";
  sourceLeadId: string;
  sourceLeadIdGenerated: boolean;
  normalizedPhone: string | null;
  normalizedEmail: string | null;
  validationStatus: Extract<BulkLeadImportRowValidationStatus, "failed" | "mapping_required">;
  duplicateStatus: BulkLeadImportRowDuplicateStatus;
  blockerReasonsJson: Prisma.InputJsonValue;
  duplicateCandidatesJson: Prisma.InputJsonValue;
  errorSummary: string;
  issues?: SanitizedSchemaIssue[];
  sourceLeadEventId: null;
};

export type NormalizeBulkImportRowResult =
  | NormalizeBulkImportRowSuccess
  | NormalizeBulkImportRowFailure;

export type NormalizeAndPersistBulkImportRowInput = {
  batchId: string;
  importLabel?: string | null;
  sourceRouteKey?: string | null;
  uploadedBy?: string | null;
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
  mapping: ImportFieldMapping;
  options: BulkImportNormalizationOptions;
  destinationReady: boolean;
  row: {
    id: string;
    rowNumber: number;
    rawRowJson: unknown;
    excluded: boolean;
    sourceLeadId: string | null;
    sourceLeadIdGenerated: boolean;
    sourceLeadEventId: string | null;
  };
  fields: Record<string, string>;
  canonical: Record<string, string>;
  unmapped: Array<{ key: string; value: string }>;
  duplicateCandidates: ImportDuplicateCandidate[];
};

function buildSchemaFailureBlockers(issues: SanitizedSchemaIssue[]): Prisma.InputJsonValue {
  return [
    "Normalized lifecycle payload failed schema validation.",
    {
      code: "lifecycle_schema_invalid",
      message: "Normalized lifecycle payload failed schema validation.",
      issues,
    },
  ] as Prisma.InputJsonValue;
}

export async function normalizeAndPersistBulkImportRow(
  input: NormalizeAndPersistBulkImportRowInput
): Promise<NormalizeBulkImportRowResult> {
  const mappingComplete = listMissingRequiredMappings(input.mapping).length === 0;
  const { sourceLeadId, sourceLeadIdGenerated } = input.row.sourceLeadId
    ? { sourceLeadId: input.row.sourceLeadId, sourceLeadIdGenerated: input.row.sourceLeadIdGenerated }
    : resolveBulkImportLeadId(input.canonical, input.batchId, input.options.vendorLabel);

  const normalizationOptions: BulkImportNormalizationOptions = {
    ...input.options,
    destinationClientAccountId: input.destinationClientAccountId,
    destinationLocationIdGhl: input.destinationLocationIdGhl,
  };

  const normalized = normalizeBulkImportRowToLifecycle({
    batchId: input.batchId,
    row: { rowNumber: input.row.rowNumber, fields: input.fields },
    canonical: input.canonical,
    unmapped: input.unmapped,
    importLabel: input.importLabel ?? undefined,
    options: normalizationOptions,
  });

  const routingMasterClientAccountId = await resolveRoutingMasterClientAccountIdForDestination(
    input.destinationClientAccountId
  );
  normalized.client_account_id = routingMasterClientAccountId;
  normalized.subaccount_id_ghl = input.destinationLocationIdGhl;

  const attribution = normalized.attribution ?? {};
  normalized.attribution = attribution;

  const sourcePlatform = asOptionalString(input.canonical.source_platform);
  if (sourcePlatform) {
    attribution.source_platform = sourcePlatform;
  }
  const sourceType = asOptionalString(input.canonical.source_type);
  if (sourceType) {
    attribution.source_type = sourceType;
  }

  const sourceIntakeAttributes = (
    normalized.routing?.source_intake as { sourceAttributes?: Record<string, unknown> } | undefined
  )?.sourceAttributes;

  const productType =
    asOptionalString(input.canonical.product_type) ||
    asOptionalString(input.options?.productType) ||
    asOptionalString(normalized.routing?.product_type) ||
    asOptionalString(sourceIntakeAttributes?.product_type);
  if (productType) {
    normalized.routing = {
      ...normalized.routing,
      product_type: productType,
    };
    normalized.policy = {
      ...(normalized.policy ?? {}),
      product_type: productType,
    };
  }

  const sourceIntake = normalized.routing?.source_intake as Record<string, unknown> | undefined;
  if (sourceIntake) {
    sourceIntake.destinationClientAccountId = input.destinationClientAccountId;
    sourceIntake.destinationLocationIdGhl = input.destinationLocationIdGhl;
    sourceIntake.routingMasterClientAccountId = routingMasterClientAccountId;
  }

  const phoneE164 = normalized.contact.phone_e164 ?? null;
  const email = normalized.contact.email?.trim().toLowerCase() ?? null;
  const duplicateStatus = classifyDuplicateStatus(input.duplicateCandidates);
  const duplicateCandidatesJson = input.duplicateCandidates as Prisma.InputJsonValue;

  const parsed = lifecycleEventSchema.safeParse(normalized);
  if (!parsed.success) {
    const issues = sanitizeZodIssues(parsed.error.issues);
    return {
      ok: false,
      error: "lifecycle_schema_invalid",
      sourceLeadId,
      sourceLeadIdGenerated,
      normalizedPhone: phoneE164,
      normalizedEmail: email,
      validationStatus: mappingComplete ? "failed" : "mapping_required",
      duplicateStatus,
      blockerReasonsJson: buildSchemaFailureBlockers(issues),
      duplicateCandidatesJson,
      errorSummary: "lifecycle_schema_invalid",
      issues,
      sourceLeadEventId: null,
    };
  }

  const eligibility = evaluateRowEligibility({
    normalized: parsed.data,
    mappingComplete,
    mapping: input.mapping,
    destinationSelected: true,
    destinationReadyForSimulation: input.destinationReady,
    duplicateCandidates: input.duplicateCandidates,
    excluded: input.row.excluded,
  });

  let sourceEventId = input.row.sourceLeadEventId;

  try {
    const routing = buildManualImportRoutingResult(
      input.batchId,
      input.destinationClientAccountId,
      input.destinationLocationIdGhl,
      input.uploadedBy ?? undefined,
      input.options
    );

    let eventStatus: SourceLeadEventStatus = "needs_review";
    if (eligibility.validationStatus === "eligible") {
      eventStatus = "routing_matched";
    } else if (eligibility.validationStatus === "duplicate_review") {
      eventStatus = "duplicate_blocked";
    }

    const crossDupes = input.duplicateCandidates.filter((c) => c.kind !== "within_batch");
    const correlationBlocks = crossDupes.some(
      (c) => c.kind === "source_lead_id" && c.blocksReview !== false
    );

    const { enrichmentMetadata } = await runSourceEnrichmentPipeline({
      rawPayload: input.fields,
      normalizedPayload: parsed.data,
      sourceProvider: "manual_import",
      sourceSystem: "csv_import",
      sourceRouteKey: input.sourceRouteKey ?? buildImportRouteKey(input.batchId),
      eventStatus,
      routingMatched: routing.matched,
      destinationFieldMapJson: undefined,
      receivedAt: new Date().toISOString(),
    });

    const normalizedWithEnrichment = attachSourceAttributesToLifecyclePayload(
      parsed.data,
      enrichmentMetadata.sourceAttributes,
      enrichmentMetadata.unmappedSourceFields
    );

    const eventUpdate = {
      status: eventStatus,
      normalizedPayloadJson: normalizedWithEnrichment as object,
      routingResultJson: routing as object,
      duplicateRiskJson: {
        blocksDelivery:
          eligibility.validationStatus === "duplicate_review" || correlationBlocks,
        correlated: correlationBlocks,
        candidateCount: input.duplicateCandidates.length,
        recommendedAction:
          input.duplicateCandidates.length > 0
            ? "Review duplicate signals before delivery."
            : "No duplicate risk detected.",
      } as object,
      enrichmentMetadataJson: enrichmentMetadata as object,
      clientAccountIdResolved: input.destinationClientAccountId,
      destinationLocationIdResolved: input.destinationLocationIdGhl,
      normalizedAt: new Date(),
      routedAt: new Date(),
      sourceLeadUid: normalized.contact.lead_uid,
      sourceLeadId,
    };

    if (!sourceEventId) {
      const event = await createSourceLeadEvent({
        sourceProvider: "manual_import",
        sourceSystem: "csv_import",
        sourceType: "bulk_import",
        sourceRouteKey: input.sourceRouteKey,
        sourceCampaignId: input.sourceRouteKey,
        sourceCampaignName: input.options.campaignLabel ?? input.importLabel,
        sourceLeadId,
        sourceLeadUid: normalized.contact.lead_uid,
        bulkImportId: input.batchId,
        bulkImportRowId: input.row.id,
        status: "received",
        rawPayloadJson: input.fields as object,
        receivedAt: new Date(),
      });
      sourceEventId = event.id;
    }

    await updateSourceLeadEvent(sourceEventId, eventUpdate);
  } catch {
    return {
      ok: false,
      error: "source_event_persistence_failed",
      sourceLeadId,
      sourceLeadIdGenerated,
      normalizedPhone: phoneE164,
      normalizedEmail: email,
      validationStatus: "failed",
      duplicateStatus,
      blockerReasonsJson: [
        "Source Intake record could not be saved. Retry normalization.",
        { code: "source_event_persistence_failed" },
      ] as Prisma.InputJsonValue,
      duplicateCandidatesJson,
      errorSummary: "source_event_persistence_failed",
      sourceLeadEventId: null,
    };
  }

  let validationStatus = eligibility.validationStatus;
  if (validationStatus === "eligible" && !sourceEventId) {
    validationStatus = "failed";
  }

  return {
    ok: true,
    sourceLeadEventId: sourceEventId,
    sourceLeadId,
    sourceLeadIdGenerated,
    normalizedPhone: phoneE164,
    normalizedEmail: email,
    validationStatus,
    duplicateStatus,
    blockerReasonsJson: eligibility.blockerReasons as Prisma.InputJsonValue,
    duplicateCandidatesJson,
    errorSummary: null,
  };
}
