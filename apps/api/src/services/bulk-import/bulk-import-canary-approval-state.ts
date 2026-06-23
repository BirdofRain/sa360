import type { BulkImportOptions } from "./bulk-import.types.js";

export type SourceIntakeCanaryInternalApprovalStatus = "not_reviewed" | "approved";

export type BulkImportCanaryApprovalSources = {
  cutoverApprovalSource: "ClientGhlDestination";
  cutoverApprovalRecordId: string | null;
  clientCutoverApproved: boolean;
  internalApprovalSource:
    | "BulkLeadImport.importOptionsJson"
    | "ClientGhlDestination"
    | "none";
  internalApprovalRecordId: string | null;
  internalApprovalStatus: SourceIntakeCanaryInternalApprovalStatus | string;
  internalApprovalSatisfied: boolean;
  batchInternalApprovalStatus: SourceIntakeCanaryInternalApprovalStatus | "not_set";
  clientDestinationInternalApprovalStatus: string;
  routingRuleCutoverApproved: boolean | null;
  routingRuleInternalApprovalStatus: string | null;
  deliveryConfigReadyForDirectCanary: boolean;
  configReadyButCutoverPending: boolean;
  destinationClientIdMismatch: string | null;
};

export function readBatchInternalApprovalStatus(
  importOptionsJson: unknown
): SourceIntakeCanaryInternalApprovalStatus | "not_set" {
  const options = (importOptionsJson ?? {}) as BulkImportOptions;
  const raw = options.sourceIntakeCanInternalApprovalStatus?.trim();
  if (raw === "approved") return "approved";
  if (raw === "not_reviewed") return "not_reviewed";
  return "not_set";
}

export function resolveBulkImportCanaryApprovalSources(input: {
  batchId: string;
  destinationClientAccountId: string;
  importOptionsJson: unknown;
  clientGhlDestinationId: string | null;
  clientCutoverApproved: boolean;
  clientInternalApprovalStatus: string | null | undefined;
  expectedDemoClientAccountId: string;
  readyForDirectCanary: boolean;
  activeRoutingRules: Array<{
    id: string;
    clientCutoverApproved: boolean;
    internalApprovalStatus: string;
  }>;
}): BulkImportCanaryApprovalSources {
  const batchInternal = readBatchInternalApprovalStatus(input.importOptionsJson);
  const clientInternal = input.clientInternalApprovalStatus?.trim() || "not_reviewed";

  let internalApprovalSource: BulkImportCanaryApprovalSources["internalApprovalSource"] = "none";
  let internalApprovalRecordId: string | null = null;
  let internalApprovalStatus: string = "not_reviewed";
  let internalApprovalSatisfied = false;

  if (batchInternal === "approved") {
    internalApprovalSource = "BulkLeadImport.importOptionsJson";
    internalApprovalRecordId = input.batchId;
    internalApprovalStatus = "approved";
    internalApprovalSatisfied = true;
  } else if (clientInternal === "approved") {
    internalApprovalSource = "ClientGhlDestination";
    internalApprovalRecordId = input.clientGhlDestinationId;
    internalApprovalStatus = "approved";
    internalApprovalSatisfied = true;
  } else if (batchInternal === "not_reviewed") {
    internalApprovalSource = "BulkLeadImport.importOptionsJson";
    internalApprovalRecordId = input.batchId;
    internalApprovalStatus = "not_reviewed";
  } else {
    internalApprovalSource = "ClientGhlDestination";
    internalApprovalRecordId = input.clientGhlDestinationId;
    internalApprovalStatus = clientInternal;
  }

  const activeRules = input.activeRoutingRules;
  const routingRuleCutoverApproved =
    activeRules.length === 0
      ? null
      : activeRules.every((rule) => rule.clientCutoverApproved === true);
  const routingRuleInternalApprovalStatus =
    activeRules.length === 0
      ? null
      : activeRules.every((rule) => rule.internalApprovalStatus === "approved")
        ? "approved"
        : activeRules.some((rule) => rule.internalApprovalStatus === "blocked")
          ? "blocked"
          : "not_reviewed";

  const destClient = input.destinationClientAccountId.trim();
  const destinationClientIdMismatch =
    destClient && destClient !== input.expectedDemoClientAccountId.trim()
      ? `Batch destination ${destClient} does not match env canary client ${input.expectedDemoClientAccountId}.`
      : null;

  const clientCutoverApproved = input.clientCutoverApproved === true;
  const configReadyButCutoverPending =
    input.readyForDirectCanary === true && !clientCutoverApproved;

  return {
    cutoverApprovalSource: "ClientGhlDestination",
    cutoverApprovalRecordId: input.clientGhlDestinationId,
    clientCutoverApproved,
    internalApprovalSource,
    internalApprovalRecordId,
    internalApprovalStatus,
    internalApprovalSatisfied,
    batchInternalApprovalStatus: batchInternal,
    clientDestinationInternalApprovalStatus: clientInternal,
    routingRuleCutoverApproved,
    routingRuleInternalApprovalStatus,
    deliveryConfigReadyForDirectCanary: input.readyForDirectCanary,
    configReadyButCutoverPending,
    destinationClientIdMismatch,
  };
}

export function mergeBatchInternalApprovalApproved(
  importOptionsJson: unknown,
  approvedAt: string = new Date().toISOString()
): BulkImportOptions {
  const current = (importOptionsJson ?? {}) as BulkImportOptions;
  return {
    ...current,
    sourceIntakeCanInternalApprovalStatus: "approved",
    sourceIntakeCanInternalApprovedAt: approvedAt,
  };
}
