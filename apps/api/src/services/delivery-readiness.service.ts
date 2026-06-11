import type {
  DeliveryMode,
  InternalApprovalStatus,
  ReadinessStatus,
} from "../lib/delivery-readiness-status.js";
import { GHL_CONNECTION_CONNECTED } from "../lib/delivery-readiness-status.js";
import { SA360_CORE_REQUIRED_FIELD_KEYS } from "../lib/sa360-custom-field-keys.js";
import type { GhlDiscoveredCustomField } from "./ghl-config-discovery/ghl-config-discovery.types.js";
import {
  assessCustomFieldStampReadiness,
  assessSa360FieldMapping,
  resolveSa360CustomFieldIdMap,
} from "./sa360-custom-field-mapping.service.js";

export type DeliveryReadinessRuleInput = {
  id?: string;
  masterClientAccountId: string;
  clientAccountId: string;
  destinationSubaccountIdGhl: string | null;
  clientDisplayName?: string | null;
  destinationWorkflowIdGhl?: string | null;
  destinationPipelineIdGhl?: string | null;
  destinationPipelineStageIdGhl?: string | null;
  defaultAssignedUserIdGhl?: string | null;
  backupSheetEnabled?: boolean;
  backupSheetId?: string | null;
  ghlConnectionStatus?: string | null;
  snapshotInstalled?: boolean;
  requiredFieldsInstalled?: boolean;
  deliveryMode?: string | null;
  deliveryEnabled?: boolean;
  clientCutoverApproved?: boolean;
  internalApprovalStatus?: string | null;
  opportunityCreationEnabled?: boolean;
  active?: boolean;
  sa360CustomFieldIdMapJson?: unknown;
  customFieldStampRequired?: boolean;
  discoveredCustomFieldsJson?: unknown;
};

export type OnboardingChecklistItem = {
  key: string;
  label: string;
  complete: boolean;
  detail?: string;
};

export type Sa360FieldMappingReadiness = {
  source: string;
  coreRequiredMapped: string[];
  coreRequiredMissing: string[];
  optionalMapped: string[];
  optionalMissing: string[];
  customFieldStampRequired: boolean;
  coreRequiredComplete: boolean;
  coreTextStampSafe: boolean;
  optionFieldsNeedValidation: string[];
};

export type DeliveryReadinessAssessment = {
  ruleId: string | null;
  clientAccountId: string;
  destinationSubaccountIdGhl: string | null;
  clientDisplayName: string | null;
  readyForShadow: boolean;
  readyForDirectCanary: boolean;
  readyForLive: boolean;
  canDeliverLive: boolean;
  readinessStatus: ReadinessStatus;
  blockers: string[];
  warnings: string[];
  missingConfig: string[];
  requiredApprovals: string[];
  recommendedNextAction: string;
  checklist: OnboardingChecklistItem[];
  fieldMapping: Sa360FieldMappingReadiness;
};

function trim(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function hasDestination(rule: DeliveryReadinessRuleInput): boolean {
  return Boolean(trim(rule.clientAccountId) && trim(rule.destinationSubaccountIdGhl));
}

function ghlConnected(rule: DeliveryReadinessRuleInput): boolean {
  const status = trim(rule.ghlConnectionStatus)?.toLowerCase();
  if (!status) return false;
  return status === GHL_CONNECTION_CONNECTED;
}

export function buildOnboardingChecklist(
  rule: DeliveryReadinessRuleInput,
  assessment: Pick<
    DeliveryReadinessAssessment,
    "readyForShadow" | "readyForDirectCanary" | "blockers" | "missingConfig"
  >
): OnboardingChecklistItem[] {
  const clientOk = Boolean(trim(rule.clientAccountId));
  const subOk = Boolean(trim(rule.destinationSubaccountIdGhl));
  const workflowOk = Boolean(trim(rule.destinationWorkflowIdGhl));
  const pipelineOk =
    !rule.opportunityCreationEnabled ||
    (Boolean(trim(rule.destinationPipelineIdGhl)) &&
      Boolean(trim(rule.destinationPipelineStageIdGhl)));
  const sheetOk =
    !rule.backupSheetEnabled || Boolean(trim(rule.backupSheetId));

  return [
    {
      key: "client_profile",
      label: "Client profile created",
      complete: clientOk,
      detail: rule.clientDisplayName ?? rule.clientAccountId,
    },
    {
      key: "ghl_subaccount",
      label: "GHL subaccount connected",
      complete: ghlConnected(rule),
      detail: rule.ghlConnectionStatus ?? "not set",
    },
    {
      key: "custom_fields",
      label: "SA360 custom fields installed",
      complete: rule.requiredFieldsInstalled === true,
      detail: undefined,
    },
    {
      key: "snapshot",
      label: "Snapshot installed",
      complete: rule.snapshotInstalled === true,
    },
    {
      key: "campaign_mapping",
      label: "Campaign mapping active",
      complete: rule.active !== false && hasDestination(rule),
    },
    {
      key: "workflow",
      label: "Workflow ID configured",
      complete: workflowOk,
    },
    {
      key: "pipeline",
      label: "Pipeline/stage configured",
      complete: pipelineOk,
      detail: rule.opportunityCreationEnabled ? undefined : "Opportunity creation disabled",
    },
    {
      key: "backup_sheet",
      label: "Backup sheet configured or disabled",
      complete: sheetOk,
    },
    {
      key: "test_lead_matched",
      label: "Test lead matched",
      complete: false,
      detail: "Validate via Routing Dry Run",
    },
    {
      key: "shadow_plan",
      label: "Shadow delivery plan generated",
      complete: false,
      detail: "Generate from Routing Dry Run",
    },
    {
      key: "legacy_validated",
      label: "Legacy delivery validated",
      complete: false,
      detail: "Mark validation in Routing Dry Run",
    },
    {
      key: "cutover_approved",
      label: "Internal cutover approved",
      complete: rule.clientCutoverApproved === true,
    },
    {
      key: "live_enabled",
      label: "Live delivery enabled",
      complete: rule.deliveryEnabled === true && trim(rule.deliveryMode) === "live",
    },
    {
      key: "direct_canary",
      label: "Ready for direct canary (guarded one-lead)",
      complete: assessment.readyForDirectCanary,
      detail: "Adapter simulation / live canary without broad auto-delivery",
    },
  ];
}

function deriveReadinessStatus(
  readyForShadow: boolean,
  readyForLive: boolean,
  canDeliverLive: boolean,
  internalApproval: string | null,
  blockers: string[]
): ReadinessStatus {
  if (internalApproval === "blocked") return "blocked";
  if (canDeliverLive) return "live_enabled";
  if (readyForLive) return "ready_for_live";
  if (readyForShadow) return "ready_for_shadow";
  if (blockers.some((b) => b.includes("destination"))) return "not_ready";
  return "needs_config";
}

export function evaluateDeliveryReadiness(
  rule: DeliveryReadinessRuleInput,
  now: Date = new Date()
): DeliveryReadinessAssessment {
  void now;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const missingConfig: string[] = [];
  const requiredApprovals: string[] = [];

  const clientAccountId = trim(rule.clientAccountId) ?? "";
  const destinationSubaccountIdGhl = trim(rule.destinationSubaccountIdGhl);
  const deliveryMode = (trim(rule.deliveryMode) ?? "shadow") as DeliveryMode;
  const internalApproval = (trim(rule.internalApprovalStatus) ??
    "not_reviewed") as InternalApprovalStatus;

  if (!clientAccountId) {
    blockers.push("Missing destination clientAccountId.");
    missingConfig.push("clientAccountId");
  }
  if (!destinationSubaccountIdGhl) {
    blockers.push("Missing destinationSubaccountIdGhl.");
    missingConfig.push("destinationSubaccountIdGhl");
  }

  const readyForShadow = hasDestination(rule);

  if (!trim(rule.destinationWorkflowIdGhl)) {
    missingConfig.push("destinationWorkflowIdGhl");
    if (readyForShadow) {
      warnings.push("Workflow ID not configured; live delivery will be blocked.");
    }
  }

  if (rule.opportunityCreationEnabled !== false) {
    if (!trim(rule.destinationPipelineIdGhl)) {
      missingConfig.push("destinationPipelineIdGhl");
    }
    if (!trim(rule.destinationPipelineStageIdGhl)) {
      missingConfig.push("destinationPipelineStageIdGhl");
    }
  }

  if (rule.backupSheetEnabled) {
    if (!trim(rule.backupSheetId)) {
      blockers.push("backupSheetEnabled is true but backupSheetId is missing.");
      missingConfig.push("backupSheetId");
    }
  }

  const { idMap, source } = resolveSa360CustomFieldIdMap({
    destinationMapJson: rule.sa360CustomFieldIdMapJson,
    useEnvFallback: false,
  });
  const fieldMapping = assessSa360FieldMapping(
    idMap,
    source,
    rule.customFieldStampRequired === true
  );
  const discoveredFields = Array.isArray(rule.discoveredCustomFieldsJson)
    ? (rule.discoveredCustomFieldsJson as GhlDiscoveredCustomField[])
    : [];
  const stampReadiness = assessCustomFieldStampReadiness({ idMap, discoveredFields });

  if (!rule.requiredFieldsInstalled) {
    blockers.push("SA360 required custom fields are not marked installed.");
    missingConfig.push("requiredFieldsInstalled");
  }

  if (fieldMapping.coreRequiredMissing.length > 0) {
    const msg = `SA360 core field mapping missing: ${fieldMapping.coreRequiredMissing.join(", ")}.`;
    if (fieldMapping.customFieldStampRequired) {
      blockers.push(msg);
      missingConfig.push("sa360CustomFieldIdMapJson");
    } else {
      warnings.push(msg);
    }
  }

  if (fieldMapping.optionalMissing.length > 0) {
    warnings.push(
      `Optional SA360 field mapping missing: ${fieldMapping.optionalMissing.slice(0, 6).join(", ")}${
        fieldMapping.optionalMissing.length > 6 ? "…" : ""
      }.`
    );
  }

  if (!rule.snapshotInstalled) {
    blockers.push("GHL snapshot is not marked installed.");
    missingConfig.push("snapshotInstalled");
  }

  if (!ghlConnected(rule)) {
    blockers.push("GHL connection is missing or not connected.");
    missingConfig.push("ghlConnectionStatus");
  }

  if (!trim(rule.defaultAssignedUserIdGhl)) {
    warnings.push("defaultAssignedUserIdGhl not set; owner assignment may be skipped.");
  }

  const technicalMissingKeys = new Set(missingConfig);

  const pipelineOkForCanary =
    rule.opportunityCreationEnabled === false ||
    (Boolean(trim(rule.destinationPipelineIdGhl)) &&
      Boolean(trim(rule.destinationPipelineStageIdGhl)));

  const readyForDirectCanary =
    hasDestination(rule) &&
    ghlConnected(rule) &&
    pipelineOkForCanary &&
    rule.snapshotInstalled === true &&
    rule.requiredFieldsInstalled === true &&
    (!fieldMapping.customFieldStampRequired || fieldMapping.coreRequiredComplete);

  const readyForLive =
    readyForShadow &&
    technicalMissingKeys.size === 0 &&
    !blockers.some(
      (b) =>
        b.includes("backupSheet") ||
        b.includes("custom fields") ||
        b.includes("snapshot") ||
        b.includes("GHL connection") ||
        b.includes("destinationSubaccount")
    );

  if (rule.deliveryEnabled !== true) {
    blockers.push("deliveryEnabled is false.");
    requiredApprovals.push("Enable deliveryEnabled after cutover checklist.");
  }

  if (deliveryMode !== "live") {
    blockers.push(`deliveryMode must be live (current: ${deliveryMode}).`);
  }

  if (rule.clientCutoverApproved !== true) {
    blockers.push("clientCutoverApproved is false.");
    requiredApprovals.push("Client cutover approval required.");
  }

  if (internalApproval !== "approved") {
    blockers.push(`internalApprovalStatus must be approved (current: ${internalApproval}).`);
    requiredApprovals.push("Internal approval required.");
  }

  if (internalApproval === "blocked") {
    blockers.push("internalApprovalStatus is blocked.");
  }

  const canDeliverLive =
    readyForLive &&
    rule.deliveryEnabled === true &&
    deliveryMode === "live" &&
    rule.clientCutoverApproved === true &&
    internalApproval === "approved";

  const readinessStatus = deriveReadinessStatus(
    readyForShadow,
    readyForLive,
    canDeliverLive,
    internalApproval,
    blockers
  );

  let recommendedNextAction = "Review blockers and complete missing configuration.";
  if (canDeliverLive) {
    recommendedNextAction =
      "Destination is fully ready for live delivery when a delivery executor is enabled (not active in this phase).";
  } else if (readyForLive && !rule.deliveryEnabled) {
    recommendedNextAction =
      "Configuration complete; obtain approvals and enable live delivery with explicit confirmation.";
  } else if (readyForShadow && !readyForLive) {
    recommendedNextAction =
      "Continue shadow dry-runs and legacy validation; complete workflow, pipeline, and GHL setup.";
  } else if (!readyForShadow) {
    recommendedNextAction = "Configure destination client and GHL subaccount on the routing rule.";
  }

  const assessment: DeliveryReadinessAssessment = {
    ruleId: rule.id ?? null,
    clientAccountId,
    destinationSubaccountIdGhl,
    clientDisplayName: trim(rule.clientDisplayName),
    readyForShadow,
    readyForDirectCanary,
    readyForLive,
    canDeliverLive,
    readinessStatus,
    blockers,
    warnings,
    missingConfig,
    requiredApprovals,
    recommendedNextAction,
    checklist: [],
    fieldMapping: {
      source: fieldMapping.source,
      coreRequiredMapped: fieldMapping.coreRequiredMapped,
      coreRequiredMissing: fieldMapping.coreRequiredMissing,
      optionalMapped: fieldMapping.optionalMapped,
      optionalMissing: fieldMapping.optionalMissing,
      customFieldStampRequired: fieldMapping.customFieldStampRequired,
      coreRequiredComplete: fieldMapping.coreRequiredComplete,
      coreTextStampSafe: stampReadiness.coreTextStampSafe,
      optionFieldsNeedValidation: stampReadiness.optionFieldsNeedValidation,
    },
  };
  assessment.checklist = buildOnboardingChecklist(rule, assessment);
  const customFieldsItem = assessment.checklist.find((c) => c.key === "custom_fields");
  if (customFieldsItem) {
    const mappingDetail = `${fieldMapping.coreRequiredMapped.length}/${SA360_CORE_REQUIRED_FIELD_KEYS.length} core fields mapped (${fieldMapping.source})`;
    const stampDetail = stampReadiness.coreTextStampSafe
      ? "core TEXT stamping safe"
      : "core includes option fields — validate dropdown values before live stamp";
    const optionDetail =
      stampReadiness.optionFieldsNeedValidation.length > 0
        ? `; option fields need validation: ${stampReadiness.optionFieldsNeedValidation.slice(0, 4).join(", ")}${
            stampReadiness.optionFieldsNeedValidation.length > 4 ? "…" : ""
          }`
        : "";
    customFieldsItem.detail = `${mappingDetail}; ${stampDetail}${optionDetail}`;
    customFieldsItem.complete =
      rule.requiredFieldsInstalled === true && fieldMapping.coreRequiredComplete;
  }
  if (stampReadiness.optionFieldsNeedValidation.length > 0) {
    warnings.push(
      `Mapped option-type custom fields require dropdown option validation before live stamp: ${stampReadiness.optionFieldsNeedValidation.slice(0, 6).join(", ")}${
        stampReadiness.optionFieldsNeedValidation.length > 6 ? "…" : ""
      }.`
    );
  }
  return assessment;
}

export function ruleInputFromCampaignRoutingRule(
  rule: DeliveryReadinessRuleInput & { id: string }
): DeliveryReadinessRuleInput {
  return rule;
}

export function persistableReadinessFields(
  assessment: DeliveryReadinessAssessment
): {
  readinessStatus: ReadinessStatus;
  readinessWarnings: string[];
  lastReadinessCheckAt: Date;
} {
  const readinessWarnings = [...assessment.blockers, ...assessment.warnings];
  return {
    readinessStatus: assessment.readinessStatus,
    readinessWarnings,
    lastReadinessCheckAt: new Date(),
  };
}
