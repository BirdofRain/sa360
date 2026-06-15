import { GHL_CONNECTION_CONNECTED } from "../lib/delivery-readiness-status.js";
import { SA360_CORE_REQUIRED_FIELD_KEYS } from "../lib/sa360-custom-field-keys.js";
import type { GhlDiscoveredCustomField } from "./ghl-config-discovery/ghl-config-discovery.types.js";
import {
  assessCustomFieldStampReadiness,
  assessSa360FieldMapping,
  resolveSa360CustomFieldIdMap,
} from "./sa360-custom-field-mapping.service.js";
import {
  buildSa360OptionMappingRows,
  formatOptionMappingReadinessWarnings,
  parseSa360CustomFieldOptionMapJson,
} from "./sa360-custom-field-option-mapping.service.js";
import type {
  DeliveryReadinessAssessment,
  OnboardingChecklistItem,
  Sa360FieldMappingReadiness,
} from "./delivery-readiness.service.js";

export type DestinationReadinessInput = {
  clientAccountId: string;
  clientDisplayName?: string | null;
  destinationSubaccountIdGhl: string | null;
  destinationWorkflowIdGhl?: string | null;
  destinationPipelineIdGhl?: string | null;
  destinationPipelineStageIdGhl?: string | null;
  defaultAssignedUserIdGhl?: string | null;
  ghlConnectionStatus?: string | null;
  snapshotInstalled?: boolean;
  requiredFieldsInstalled?: boolean;
  opportunityCreationEnabled?: boolean;
  sa360CustomFieldIdMapJson?: unknown;
  sa360CustomFieldOptionMapJson?: unknown;
  customFieldStampRequired?: boolean;
  ownerAssignmentRequired?: boolean;
  workflowStartRequired?: boolean;
  workflowTriggerMode?: string | null;
  discoveredCustomFieldsJson?: unknown;
  /** Live OAuth connection probe state when available. */
  connectionStatus?: string | null;
  lastProbeAt?: Date | string | null;
  lastError?: string | null;
};

export type DestinationReadinessIssueCode =
  | "client_not_found"
  | "location_unlinked"
  | "oauth_revoked"
  | "probe_required"
  | "location_mismatch";

export type DestinationReadinessAssessment = Omit<
  DeliveryReadinessAssessment,
  "ruleId" | "canDeliverLive" | "readyForLive" | "requiredApprovals"
> & {
  issueCodes: DestinationReadinessIssueCode[];
  readyForSimulation: boolean;
};

function trim(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function ghlConnected(input: DestinationReadinessInput): boolean {
  const liveStatus = trim(input.connectionStatus)?.toLowerCase();
  if (liveStatus === GHL_CONNECTION_CONNECTED) return true;
  const destStatus = trim(input.ghlConnectionStatus)?.toLowerCase();
  return destStatus === GHL_CONNECTION_CONNECTED;
}

function probeHealthy(input: DestinationReadinessInput): boolean {
  const status = trim(input.connectionStatus)?.toLowerCase();
  if (status === "revoked" || status === "error") return false;
  if (input.lastProbeAt) return true;
  return false;
}

function workflowConfigured(input: DestinationReadinessInput): boolean {
  if (trim(input.destinationWorkflowIdGhl)) return true;
  const mode = trim(input.workflowTriggerMode)?.toLowerCase();
  if (mode === "tag_trigger") return true;
  if (input.workflowStartRequired !== true) return true;
  return false;
}

function ownerConfigured(input: DestinationReadinessInput): boolean {
  if (trim(input.defaultAssignedUserIdGhl)) return true;
  return input.ownerAssignmentRequired !== true;
}

export function buildDestinationOnboardingChecklist(
  input: DestinationReadinessInput,
  assessment: Pick<
    DestinationReadinessAssessment,
    "readyForDirectCanary" | "readyForSimulation" | "blockers"
  >
): OnboardingChecklistItem[] {
  const linked =
    Boolean(trim(input.clientAccountId)) && Boolean(trim(input.destinationSubaccountIdGhl));
  const pipelineOk =
    input.opportunityCreationEnabled === false ||
    (Boolean(trim(input.destinationPipelineIdGhl)) &&
      Boolean(trim(input.destinationPipelineStageIdGhl)));

  return [
    {
      key: "oauth_connected",
      label: "OAuth connected",
      complete: ghlConnected(input),
      detail: input.connectionStatus ?? input.ghlConnectionStatus ?? "not connected",
    },
    {
      key: "client_linked",
      label: "Client linked to GHL location",
      complete: linked,
      detail: input.destinationSubaccountIdGhl ?? "no location",
    },
    {
      key: "probe_healthy",
      label: "Probe healthy",
      complete: probeHealthy(input),
      detail: input.lastProbeAt
        ? new Date(input.lastProbeAt).toISOString()
        : input.lastError ?? "run probe",
    },
    {
      key: "pipeline",
      label: "Pipeline configured",
      complete: Boolean(trim(input.destinationPipelineIdGhl)) || input.opportunityCreationEnabled === false,
      detail: input.opportunityCreationEnabled === false ? "Opportunity creation disabled" : undefined,
    },
    {
      key: "new_lead_stage",
      label: "New Lead stage configured",
      complete: Boolean(trim(input.destinationPipelineStageIdGhl)) || input.opportunityCreationEnabled === false,
    },
    {
      key: "core_fields_mapped",
      label: "SA360 core fields mapped",
      complete: assessment.blockers.every((b) => !b.includes("core field mapping missing")),
    },
    {
      key: "option_mappings",
      label: "Option mappings complete",
      complete: !assessment.blockers.some((b) => b.includes("option mapping")),
    },
    {
      key: "snapshot",
      label: "Snapshot installed",
      complete: input.snapshotInstalled === true,
    },
    {
      key: "owner",
      label: "Owner configured or optional",
      complete: ownerConfigured(input),
    },
    {
      key: "workflow",
      label: "Workflow configured or tag-trigger fallback",
      complete: workflowConfigured(input),
    },
    {
      key: "ready_for_simulation",
      label: "Destination ready for simulation",
      complete: assessment.readyForSimulation,
    },
    {
      key: "direct_canary",
      label: "Destination ready for direct canary",
      complete: assessment.readyForDirectCanary,
    },
  ].map((item) => ({
    ...item,
    complete: item.complete && pipelineOk,
  }));
}

export function evaluateDestinationReadiness(
  input: DestinationReadinessInput
): DestinationReadinessAssessment {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const missingConfig: string[] = [];
  const issueCodes: DestinationReadinessIssueCode[] = [];

  const clientAccountId = trim(input.clientAccountId) ?? "";
  const destinationSubaccountIdGhl = trim(input.destinationSubaccountIdGhl);

  if (!clientAccountId) {
    blockers.push("Missing clientAccountId.");
    missingConfig.push("clientAccountId");
  }
  if (!destinationSubaccountIdGhl) {
    blockers.push("Missing destinationSubaccountIdGhl.");
    missingConfig.push("destinationSubaccountIdGhl");
    issueCodes.push("location_unlinked");
  }

  const connStatus = trim(input.connectionStatus)?.toLowerCase();
  if (connStatus === "revoked") {
    blockers.push("OAuth connection is revoked.");
    issueCodes.push("oauth_revoked");
  }
  if (connStatus === "error") {
    blockers.push("OAuth connection is in error state.");
  }
  if (connStatus && connStatus !== "revoked" && connStatus !== "connected" && !input.lastProbeAt) {
    warnings.push("Run a probe before discovering configuration.");
    issueCodes.push("probe_required");
  }
  if (!probeHealthy(input) && connStatus === "connected") {
    issueCodes.push("probe_required");
  }

  if (!ghlConnected(input)) {
    blockers.push("GHL connection is missing or not connected.");
    missingConfig.push("ghlConnectionStatus");
  }

  if (input.opportunityCreationEnabled !== false) {
    if (!trim(input.destinationPipelineIdGhl)) {
      missingConfig.push("destinationPipelineIdGhl");
    }
    if (!trim(input.destinationPipelineStageIdGhl)) {
      missingConfig.push("destinationPipelineStageIdGhl");
    }
  }

  if (!input.requiredFieldsInstalled) {
    blockers.push("SA360 required custom fields are not marked installed.");
    missingConfig.push("requiredFieldsInstalled");
  }

  if (!input.snapshotInstalled) {
    blockers.push("GHL snapshot is not marked installed.");
    missingConfig.push("snapshotInstalled");
  }

  const { idMap, source } = resolveSa360CustomFieldIdMap({
    destinationMapJson: input.sa360CustomFieldIdMapJson,
    useEnvFallback: false,
  });
  const fieldMapping = assessSa360FieldMapping(
    idMap,
    source,
    input.customFieldStampRequired === true
  );
  const discoveredFields = Array.isArray(input.discoveredCustomFieldsJson)
    ? (input.discoveredCustomFieldsJson as GhlDiscoveredCustomField[])
    : [];
  const optionMapJson = parseSa360CustomFieldOptionMapJson(input.sa360CustomFieldOptionMapJson);
  const stampReadiness = assessCustomFieldStampReadiness({
    idMap,
    discoveredFields,
    optionMap: optionMapJson,
  });
  const optionMappingRows = buildSa360OptionMappingRows({
    optionMap: optionMapJson,
    discoveredFields,
  });
  const optionMappingWarnings = formatOptionMappingReadinessWarnings({
    mappedFieldCount: optionMappingRows.filter((r) => r.status === "mapped").length,
    totalCanonicalEntries: optionMappingRows.length,
    missingMappings: optionMappingRows
      .filter((r) => r.status === "missing")
      .map((r) => ({ logicalKey: r.logicalKey, canonicalValue: r.canonicalValue })),
    invalidMappings: optionMappingRows
      .filter((r) => r.status === "invalid" && r.mappedGhlValue)
      .map((r) => ({
        logicalKey: r.logicalKey,
        canonicalValue: r.canonicalValue,
        mappedGhlValue: r.mappedGhlValue!,
      })),
    rows: optionMappingRows,
  });

  if (fieldMapping.coreRequiredMissing.length > 0) {
    const msg = `SA360 core field mapping missing: ${fieldMapping.coreRequiredMissing.join(", ")}.`;
    if (fieldMapping.customFieldStampRequired) {
      blockers.push(msg);
      missingConfig.push("sa360CustomFieldIdMapJson");
    } else {
      warnings.push(msg);
    }
  }

  if (!ownerConfigured(input)) {
    missingConfig.push("defaultAssignedUserIdGhl");
    warnings.push("defaultAssignedUserIdGhl not set but owner assignment is required.");
  }

  if (!workflowConfigured(input)) {
    missingConfig.push("destinationWorkflowIdGhl");
    warnings.push("Workflow not configured; configure workflow or use tag-trigger fallback.");
  }

  for (const w of optionMappingWarnings) {
    if (w.includes("missing")) {
      blockers.push(`Option mapping: ${w}`);
    } else {
      warnings.push(w);
    }
  }

  const hasDestination =
    Boolean(trim(input.clientAccountId)) && Boolean(trim(input.destinationSubaccountIdGhl));
  const pipelineOkForCanary =
    input.opportunityCreationEnabled === false ||
    (Boolean(trim(input.destinationPipelineIdGhl)) &&
      Boolean(trim(input.destinationPipelineStageIdGhl)));

  const readyForSimulation =
    hasDestination && ghlConnected(input) && probeHealthy(input) && pipelineOkForCanary;

  const readyForDirectCanary =
    readyForSimulation &&
    input.snapshotInstalled === true &&
    input.requiredFieldsInstalled === true &&
    (!fieldMapping.customFieldStampRequired || fieldMapping.coreRequiredComplete) &&
    ownerConfigured(input) &&
    workflowConfigured(input);

  let readinessStatus: DeliveryReadinessAssessment["readinessStatus"] = "needs_config";
  if (!hasDestination || !ghlConnected(input)) {
    readinessStatus = "not_ready";
  } else if (readyForDirectCanary) {
    readinessStatus = "ready_for_shadow";
  } else if (readyForSimulation) {
    readinessStatus = "ready_for_shadow";
  }

  let recommendedNextAction = "Complete destination configuration for this GHL location.";
  if (issueCodes.includes("oauth_revoked")) {
    recommendedNextAction = "Reconnect the GHL location via OAuth.";
  } else if (issueCodes.includes("location_unlinked")) {
    recommendedNextAction = "Connect or link a GHL location to this client.";
  } else if (issueCodes.includes("probe_required")) {
    recommendedNextAction = "Run a probe before discovering configuration.";
  } else if (readyForDirectCanary) {
    recommendedNextAction =
      "Destination is ready for simulation and direct canary. Create a routing rule when a source is ready.";
  } else if (readyForSimulation) {
    recommendedNextAction = "Finish pipeline, field mappings, snapshot, and workflow/owner settings.";
  }

  const fieldMappingResult: Sa360FieldMappingReadiness = {
    source: fieldMapping.source,
    coreRequiredMapped: fieldMapping.coreRequiredMapped,
    coreRequiredMissing: fieldMapping.coreRequiredMissing,
    optionalMapped: fieldMapping.optionalMapped,
    optionalMissing: fieldMapping.optionalMissing,
    customFieldStampRequired: fieldMapping.customFieldStampRequired,
    coreRequiredComplete: fieldMapping.coreRequiredComplete,
    coreTextStampSafe: stampReadiness.coreTextStampSafe,
    optionFieldsNeedValidation: stampReadiness.optionFieldsNeedValidation,
    optionMapJson,
    optionMappingWarnings,
  };

  const assessment: DestinationReadinessAssessment = {
    clientAccountId,
    destinationSubaccountIdGhl,
    clientDisplayName: trim(input.clientDisplayName),
    readyForShadow: hasDestination,
    readyForDirectCanary,
    readinessStatus,
    blockers,
    warnings,
    missingConfig,
    recommendedNextAction,
    checklist: [],
    fieldMapping: fieldMappingResult,
    issueCodes,
    readyForSimulation,
  };

  assessment.checklist = buildDestinationOnboardingChecklist(input, assessment);
  const coreFieldsItem = assessment.checklist.find((c) => c.key === "core_fields_mapped");
  if (coreFieldsItem) {
    coreFieldsItem.detail = `${fieldMapping.coreRequiredMapped.length}/${SA360_CORE_REQUIRED_FIELD_KEYS.length} core fields mapped (${fieldMapping.source})`;
    coreFieldsItem.complete =
      input.requiredFieldsInstalled === true && fieldMapping.coreRequiredComplete;
  }

  return assessment;
}

export function destinationInputFromGhlDestination(
  client: { clientAccountId: string; clientDisplayName: string },
  dest: {
    destinationSubaccountIdGhl: string;
    destinationWorkflowIdGhl: string | null;
    destinationPipelineIdGhl: string | null;
    destinationPipelineStageIdGhl: string | null;
    defaultAssignedUserIdGhl: string | null;
    ghlConnectionStatus: string | null;
    snapshotInstalled: boolean;
    requiredFieldsInstalled: boolean;
    opportunityCreationEnabled: boolean;
    sa360CustomFieldIdMapJson?: unknown;
    sa360CustomFieldOptionMapJson?: unknown;
    customFieldStampRequired?: boolean;
    ownerAssignmentRequired?: boolean;
    workflowStartRequired?: boolean;
    workflowTriggerMode?: string | null;
  },
  connection?: {
    connectionStatus: string;
    lastProbeAt: Date | null;
    lastError: string | null;
  } | null
): DestinationReadinessInput {
  return {
    clientAccountId: client.clientAccountId,
    clientDisplayName: client.clientDisplayName,
    destinationSubaccountIdGhl: dest.destinationSubaccountIdGhl,
    destinationWorkflowIdGhl: dest.destinationWorkflowIdGhl,
    destinationPipelineIdGhl: dest.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: dest.destinationPipelineStageIdGhl,
    defaultAssignedUserIdGhl: dest.defaultAssignedUserIdGhl,
    ghlConnectionStatus: dest.ghlConnectionStatus,
    snapshotInstalled: dest.snapshotInstalled,
    requiredFieldsInstalled: dest.requiredFieldsInstalled,
    opportunityCreationEnabled: dest.opportunityCreationEnabled,
    sa360CustomFieldIdMapJson: dest.sa360CustomFieldIdMapJson,
    sa360CustomFieldOptionMapJson: dest.sa360CustomFieldOptionMapJson,
    customFieldStampRequired: dest.customFieldStampRequired,
    ownerAssignmentRequired: dest.ownerAssignmentRequired,
    workflowStartRequired: dest.workflowStartRequired,
    workflowTriggerMode: dest.workflowTriggerMode,
    connectionStatus: connection?.connectionStatus ?? null,
    lastProbeAt: connection?.lastProbeAt ?? null,
    lastError: connection?.lastError ?? null,
  };
}
