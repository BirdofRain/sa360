import type { IncomingFieldConflict } from "./incoming-field-resolution.js";
import type { CanonicalSourceAttributeKey } from "./source-field-alias.registry.js";

export type IntakeStatus =
  | "received"
  | "normalized"
  | "invalid_identity"
  | "routing_matched"
  | "routing_unmatched";

export type EnrichmentStatus = "complete" | "partial" | "none" | "mapping_required";

export type AutomationReadiness = "ready" | "limited" | "blocked";

export type SourceSchemaStatus = "known" | "changed" | "first_seen";

export type SourceFieldRequirement = "delivery_required" | "automation_required" | "optional" | "ignored";

export type SourceAttributeFieldMappingEntry = {
  ghlFieldKey: string;
  requirement?: SourceFieldRequirement;
};

export type SourceEnrichmentPolicy = {
  /** Canonical keys required for Voice AI rich context (default: branch, best_time, desired_coverage). */
  aiContextRequired?: CanonicalSourceAttributeKey[];
  /** Canonical keys to ignore during enrichment. */
  ignoredCanonicalKeys?: CanonicalSourceAttributeKey[];
  /** When automation is limited: basic_voice_ai | queue_for_review | wait_for_enrichment */
  limitedAutomationBehavior?: "basic_voice_ai" | "queue_for_review" | "wait_for_enrichment";
  /**
   * Optional intake-summary note. Only an explicit true posts a note.
   * Persistence of this flag stays in the existing policy JSON. It does not
   * enable delivery.
   */
  intakeSummaryNotesEnabled?: boolean;
};

export type UnmappedSourceField = {
  key: string;
  value: unknown;
  sourceSystem: string;
  receivedAt: string;
};

export type SourceSchemaDrift = {
  addedFields: string[];
  removedFields: string[];
  possibleRenames: Array<{ from: string; to: string; canonical: string }>;
  schemaFingerprint: string;
  warnings: string[];
};

export type SourceAttributes = Partial<
  Record<CanonicalSourceAttributeKey, string | number | boolean | null>
>;

export type SourceEnrichmentMetadata = {
  intakeStatus: IntakeStatus;
  enrichmentStatus: EnrichmentStatus;
  automationReadiness: AutomationReadiness;
  sourceSchemaStatus: SourceSchemaStatus;
  sourceAttributes: SourceAttributes;
  unmappedSourceFields: UnmappedSourceField[];
  missingOptionalFields: string[];
  missingAiContextFields: string[];
  unmappedSourceFieldKeys: string[];
  fieldAliasConflicts?: IncomingFieldConflict[];
  schemaDrift?: SourceSchemaDrift;
  deliveryEligible: boolean;
  deliveryBlockers: string[];
  deliveryWarnings: string[];
  mappedFieldCount: number;
};

export type SourceEnrichmentDeliveryContext = {
  sourceAttributes: SourceAttributes;
  enrichmentStatus: EnrichmentStatus;
  automationReadiness: AutomationReadiness;
  missingOptionalFields: string[];
  unmappedSourceFieldKeys: string[];
  sourceAttributeFieldMap: Record<string, SourceAttributeFieldMappingEntry>;
  sourceEnrichmentPolicy: SourceEnrichmentPolicy;
};
