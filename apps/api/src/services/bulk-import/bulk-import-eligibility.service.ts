import type { BulkLeadImportRowValidationStatus } from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { hasDeliverableIdentity } from "../source-intake/source-enrichment.service.js";
import type { ImportDuplicateCandidate } from "./bulk-import.types.js";
import {
  classifyDuplicateStatus,
  duplicateStatusBlocksDelivery,
  getBlockingDuplicateCandidates,
} from "./bulk-import-duplicate.service.js";
import type { ImportFieldMapping } from "./bulk-import.types.js";
import { listMissingRequiredMappings } from "./csv-import-mapping.service.js";

export type RowEligibilityInput = {
  normalized: LifecycleEventSchema | null;
  mappingComplete: boolean;
  mapping?: ImportFieldMapping;
  destinationSelected: boolean;
  destinationReadyForSimulation: boolean;
  duplicateCandidates: ImportDuplicateCandidate[];
  excluded?: boolean;
};

export type RowEligibilityResult = {
  validationStatus: BulkLeadImportRowValidationStatus;
  blockerReasons: string[];
  deliveryEligible: boolean;
};

export function evaluateRowEligibility(input: RowEligibilityInput): RowEligibilityResult {
  const blockerReasons: string[] = [];

  if (input.excluded) {
    return {
      validationStatus: "excluded",
      blockerReasons: ["Row excluded by operator"],
      deliveryEligible: false,
    };
  }

  if (!input.mappingComplete) {
    const missing = input.mapping ? listMissingRequiredMappings(input.mapping) : ["mapping"];
    return {
      validationStatus: "mapping_required",
      blockerReasons: missing.map((m) => `Missing required mapping: ${m}`),
      deliveryEligible: false,
    };
  }

  if (!input.destinationSelected) {
    blockerReasons.push("Destination not selected");
    return {
      validationStatus: "destination_blocked",
      blockerReasons,
      deliveryEligible: false,
    };
  }

  if (!input.destinationReadyForSimulation) {
    blockerReasons.push("Destination not ready for simulation");
    return {
      validationStatus: "destination_blocked",
      blockerReasons,
      deliveryEligible: false,
    };
  }

  if (!input.normalized) {
    return {
      validationStatus: "failed",
      blockerReasons: ["Normalization failed"],
      deliveryEligible: false,
    };
  }

  const identity = hasDeliverableIdentity(input.normalized);
  if (!identity.ok) {
    return {
      validationStatus: "identity_blocked",
      blockerReasons: identity.blockers,
      deliveryEligible: false,
    };
  }

  const blockingDupes = getBlockingDuplicateCandidates(input.duplicateCandidates);
  const dupStatus = classifyDuplicateStatus(input.duplicateCandidates);
  if (duplicateStatusBlocksDelivery(dupStatus)) {
    return {
      validationStatus: "duplicate_review",
      blockerReasons: blockingDupes.map((c) => c.detail),
      deliveryEligible: false,
    };
  }

  if (blockingDupes.length > 0) {
    return {
      validationStatus: "duplicate_review",
      blockerReasons: blockingDupes.map((c) => c.detail),
      deliveryEligible: false,
    };
  }

  return {
    validationStatus: "eligible",
    blockerReasons: [],
    deliveryEligible: true,
  };
}

export {
  summarizeBulkImportRowEligibility as summarizeRowEligibility,
  type BulkImportEligibilitySummary,
} from "./bulk-import-simulation-eligibility.service.js";
