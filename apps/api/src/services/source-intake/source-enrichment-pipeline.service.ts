import type { SourceLeadEventStatus } from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import {
  extractSourceAttributesFromPayload,
  type SourceAttributeExtractionResult,
} from "./source-attribute-extractor.service.js";
import {
  deriveIntakeStatus,
  evaluateSourceEnrichment,
  hasDeliverableIdentity,
  parseSourceEnrichmentPolicyJson,
  resolveEffectiveRouteAliasOverrides,
  resolveEffectiveSourceAttributeFieldMap,
} from "./source-enrichment.service.js";
import { detectSourceSchemaDrift } from "./source-schema-drift.service.js";
import { materializeLeadCapturePayload } from "./leadcapture-payload-resolver.js";
import type { SourceEnrichmentMetadata } from "./source-enrichment.types.js";

export type RunSourceEnrichmentPipelineInput = {
  rawPayload: Record<string, unknown>;
  normalizedPayload: LifecycleEventSchema;
  sourceProvider: string;
  sourceSystem: string;
  sourceRouteKey: string;
  eventStatus: SourceLeadEventStatus;
  routingMatched: boolean;
  destinationFieldMapJson?: unknown;
  destinationEnrichmentPolicyJson?: unknown;
  destinationAliasOverridesJson?: unknown;
  routeFieldMapJson?: unknown;
  routeAliasOverridesJson?: unknown;
  receivedAt: string;
};

export async function runSourceEnrichmentPipeline(
  input: RunSourceEnrichmentPipelineInput
): Promise<{
  enrichmentMetadata: SourceEnrichmentMetadata;
  extraction: SourceAttributeExtractionResult;
}> {
  const routeAliasOverrides = resolveEffectiveRouteAliasOverrides(
    {
      sourceFieldAliasOverridesJson: input.destinationAliasOverridesJson,
    } as { sourceFieldAliasOverridesJson?: unknown },
    {
      sourceFieldAliasOverridesJson: input.routeAliasOverridesJson,
    } as { sourceFieldAliasOverridesJson?: unknown }
  );

  const leadCaptureMaterialized =
    input.sourceProvider === "leadcapture_io"
      ? materializeLeadCapturePayload(input.rawPayload, { routeAliasOverrides })
      : undefined;

  const extraction = extractSourceAttributesFromPayload(input.rawPayload, {
    sourceSystem: input.sourceSystem,
    receivedAt: input.receivedAt,
    routeAliasOverrides,
    leadCaptureMaterialized,
  });

  const schema = await detectSourceSchemaDrift({
    sourceProvider: input.sourceProvider,
    sourceRouteKey: input.sourceRouteKey,
    incomingAnswerKeys: extraction.incomingAnswerKeys,
    routeAliasOverrides,
  });

  const fieldMap = resolveEffectiveSourceAttributeFieldMap(
    { sourceAttributeFieldMapJson: input.destinationFieldMapJson } as {
      sourceAttributeFieldMapJson?: unknown;
    },
    { sourceAttributeFieldMapJson: input.routeFieldMapJson } as {
      sourceAttributeFieldMapJson?: unknown;
    }
  );

  const policy = parseSourceEnrichmentPolicyJson(input.destinationEnrichmentPolicyJson);

  const identity = hasDeliverableIdentity(input.normalizedPayload);
  const enrichmentEval = evaluateSourceEnrichment({
    sourceAttributes: extraction.sourceAttributes,
    unmappedSourceFieldKeys: extraction.unmappedSourceFieldKeys,
    sourceAttributeFieldMap: fieldMap,
    sourceEnrichmentPolicy: policy,
    routingMatched: input.routingMatched,
    identityValid: identity.ok,
  });

  const intakeStatus = deriveIntakeStatus(
    input.eventStatus,
    identity.ok,
    input.routingMatched
  );

  const enrichmentMetadata: SourceEnrichmentMetadata = {
    intakeStatus,
    enrichmentStatus: enrichmentEval.enrichmentStatus,
    automationReadiness: enrichmentEval.automationReadiness,
    sourceSchemaStatus: schema.sourceSchemaStatus,
    sourceAttributes: extraction.sourceAttributes,
    unmappedSourceFields: extraction.unmappedSourceFields,
    missingOptionalFields: enrichmentEval.missingOptionalFields,
    missingAiContextFields: enrichmentEval.missingAiContextFields,
    unmappedSourceFieldKeys: extraction.unmappedSourceFieldKeys,
    schemaDrift: schema.schemaDrift,
    deliveryEligible: enrichmentEval.deliveryEligible,
    deliveryBlockers: [...identity.blockers, ...enrichmentEval.deliveryBlockers],
    deliveryWarnings: [
      ...enrichmentEval.deliveryWarnings,
      ...schema.schemaDrift.warnings,
    ],
    mappedFieldCount: enrichmentEval.mappedFieldCount,
  };

  return { enrichmentMetadata, extraction };
}

/** Merge sourceAttributes into lifecycle routing.source_intake for delivery path. */
export function attachSourceAttributesToLifecyclePayload(
  payload: LifecycleEventSchema,
  sourceAttributes: SourceEnrichmentMetadata["sourceAttributes"],
  unmappedSourceFields: SourceEnrichmentMetadata["unmappedSourceFields"]
): LifecycleEventSchema {
  const routing = payload.routing ?? {};
  const sourceIntake = (routing.source_intake ?? {}) as Record<string, unknown>;
  return {
    ...payload,
    routing: {
      ...routing,
      source_intake: {
        ...sourceIntake,
        sourceAttributes,
        unmappedSourceFieldsJson: unmappedSourceFields,
        compliance: {
          ...((sourceIntake.compliance as Record<string, unknown> | undefined) ?? {}),
          ...sourceAttributes,
        },
      },
    },
  };
}
