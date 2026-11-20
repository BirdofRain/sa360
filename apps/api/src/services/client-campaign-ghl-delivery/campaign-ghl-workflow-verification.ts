/**
 * Read-only workflow verification for one client location.
 *
 * Unknown is not true. A caller-supplied workflowLiveVerified boolean is not
 * an input. Direct API enrollment support is not visible on the workflow list,
 * so it stays unknown. This module only issues GET requests through the
 * existing discovery client.
 */

import {
  GHL_CONFIG_DISCOVERY_PATHS,
  ghlReadOnlyGet,
} from "../ghl-config-discovery/ghl-config-discovery-client.js";
import { detectSa360RequiredCustomFields } from "../ghl-config-discovery/ghl-config-discovery.service.js";
import {
  SA360_REQUIRED_GHL_CUSTOM_FIELD_KEYS,
  type GhlDiscoveredCustomField,
} from "../ghl-config-discovery/ghl-config-discovery.types.js";
import { auditCampaignTagTriggers, type TagTriggerAudit } from "./campaign-ghl-tag-trigger-audit.js";
import type {
  EnrollmentTriState,
  LegacyAutomationTriState,
  TagTriggerCollision,
  WorkflowTriState,
} from "./plan-campaign-ghl-delivery.js";

export type TriBool = "true" | "false" | "unknown";

const ELIGIBLE_STATUSES = new Set(["published", "active"]);
const INELIGIBLE_STATUSES = new Set(["draft", "paused", "inactive", "archived", "deleted"]);

export type WorkflowDiscoveryEvidence = {
  snapshotVerification: "live" | "cached" | "previously_captured" | "unavailable";
  triggerInspectionComplete: boolean;
  workflows: Array<{
    id: string;
    status: string | null;
    locationId: string | null;
    triggers: Array<{ type: string | null; filters: string[] }> | null;
  }>;
  customFieldKeys: string[] | null;
  readError: boolean;
};

export type CampaignWorkflowVerification = {
  evidenceSource: "live_location_discovery";
  callerBooleanIgnored: true;
  locationOwnedByClient: TriBool;
  workflowExists: TriBool;
  workflowInLocation: TriBool;
  workflowEligible: WorkflowTriState;
  directApiEnrollment: EnrollmentTriState;
  requiredContactValues: TriBool;
  requiredCustomFieldsInstalled: TriBool;
  triggerModeCompatible: TriBool;
  legacyAutomation: LegacyAutomationTriState;
  tagTriggerCollision: TagTriggerCollision;
  tagAudit: TagTriggerAudit;
  directApiEnrollmentEliminatesCollisions: false;
};

export function verifyCampaignWorkflow(input: {
  clientOwnsLocation: boolean;
  locationId: string;
  workflowId: string;
  triggerMode: string | null;
  contact: { name: boolean; phone: boolean; email: boolean };
  attributionTags: readonly string[];
  evidence: WorkflowDiscoveryEvidence;
}): CampaignWorkflowVerification {
  const live = input.evidence.snapshotVerification === "live" && input.evidence.readError !== true;
  const workflow = live
    ? input.evidence.workflows.find((item) => item.id === input.workflowId) ?? null
    : null;
  const workflowExists: TriBool = !live ? "unknown" : workflow ? "true" : "false";
  const workflowInLocation: TriBool = !live
    ? "unknown"
    : !workflow
      ? "false"
      : workflow.locationId === null
        ? "unknown"
        : workflow.locationId === input.locationId
          ? "true"
          : "false";
  const status = workflow?.status?.trim().toLowerCase() ?? "";
  const workflowEligible: WorkflowTriState = !live || !workflow
    ? "unknown"
    : ELIGIBLE_STATUSES.has(status)
      ? "eligible"
      : INELIGIBLE_STATUSES.has(status)
        ? "ineligible"
        : "unknown";
  const customFields = customFieldTri(input.evidence, live);
  const contactReady = input.contact.name && input.contact.phone && input.contact.email;
  const triggerModeCompatible: TriBool = input.triggerMode === "direct_api" ? "true" : "false";
  const tagAudit = auditCampaignTagTriggers({
    triggerInspectionComplete: live && input.evidence.triggerInspectionComplete === true,
    workflows: live ? input.evidence.workflows : [],
    attributionTags: input.attributionTags,
  });
  const legacyAutomation: LegacyAutomationTriState =
    input.triggerMode === "tag_trigger" || tagAudit.legacyEntryListener
      ? "conflict"
      : tagAudit.outcome === "UNKNOWN"
        ? "unknown"
        : "safe";

  return {
    evidenceSource: "live_location_discovery",
    callerBooleanIgnored: true,
    locationOwnedByClient: input.clientOwnsLocation ? "true" : "false",
    workflowExists,
    workflowInLocation,
    workflowEligible,
    directApiEnrollment: "unknown",
    requiredContactValues: contactReady ? "true" : "false",
    requiredCustomFieldsInstalled: customFields,
    triggerModeCompatible,
    legacyAutomation,
    tagTriggerCollision: tagAudit.outcome,
    tagAudit,
    directApiEnrollmentEliminatesCollisions: false,
  };
}

export async function readCampaignWorkflowEvidence(
  locationId: string,
  fetchImpl: typeof fetch = fetch
): Promise<WorkflowDiscoveryEvidence> {
  const [workflows, fields] = await Promise.all([
    ghlReadOnlyGet(locationId, GHL_CONFIG_DISCOVERY_PATHS.workflows, { locationId }, fetchImpl),
    ghlReadOnlyGet(locationId, GHL_CONFIG_DISCOVERY_PATHS.customFields(locationId), undefined, fetchImpl),
  ]);
  if (!workflows.ok || !fields.ok) {
    return {
      snapshotVerification: "unavailable",
      triggerInspectionComplete: false,
      workflows: [],
      customFieldKeys: null,
      readError: true,
    };
  }
  const parsed = parseWorkflows(workflows.json);
  return {
    snapshotVerification: "live",
    triggerInspectionComplete: parsed.triggerInspectionComplete,
    workflows: parsed.workflows,
    customFieldKeys: foundCustomFieldKeys(parseCustomFields(fields.json)),
    readError: false,
  };
}

function customFieldTri(evidence: WorkflowDiscoveryEvidence, live: boolean): TriBool {
  if (!live || evidence.customFieldKeys === null) return "unknown";
  const found = new Set(evidence.customFieldKeys);
  const missing = SA360_REQUIRED_GHL_CUSTOM_FIELD_KEYS.filter((key) => !found.has(key));
  return missing.length === 0 ? "true" : "false";
}

function foundCustomFieldKeys(fields: GhlDiscoveredCustomField[]): string[] {
  return detectSa360RequiredCustomFields(fields).foundRequiredFields;
}

function parseWorkflows(json: unknown): {
  workflows: WorkflowDiscoveryEvidence["workflows"];
  triggerInspectionComplete: boolean;
} {
  const items = collection(json, "workflows");
  const workflows: WorkflowDiscoveryEvidence["workflows"] = [];
  let triggerInspectionComplete = items.length > 0;
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      triggerInspectionComplete = false;
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = text(record.id);
    if (!id) {
      triggerInspectionComplete = false;
      continue;
    }
    const triggers = parseTriggers(record.triggers ?? record.triggerFilters);
    if (!triggers) triggerInspectionComplete = false;
    workflows.push({
      id,
      status: text(record.status),
      locationId: text(record.locationId) ?? text(record.location_id),
      triggers,
    });
  }
  if (workflows.length === 0) triggerInspectionComplete = false;
  return { workflows, triggerInspectionComplete };
}

function parseTriggers(value: unknown): Array<{ type: string | null; filters: string[] }> | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { type: null, filters: [] };
    const record = item as Record<string, unknown>;
    const filters = [record.filters, record.tags, record.tag, record.name]
      .flatMap((entry) => (Array.isArray(entry) ? entry : entry ? [entry] : []))
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    return { type: text(record.type) ?? text(record.name), filters };
  });
}

function parseCustomFields(json: unknown): GhlDiscoveredCustomField[] {
  return collection(json, "customFields").flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = text(record.id);
    if (!id) return [];
    return [
      {
        id,
        name: text(record.name) ?? id,
        key: text(record.key),
        fieldKey: text(record.fieldKey),
        dataType: text(record.dataType),
      },
    ];
  });
}

function collection(json: unknown, key: string): unknown[] {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  const record = json as Record<string, unknown>;
  for (const name of [key, "data", "items", "results"]) {
    if (Array.isArray(record[name])) return record[name] as unknown[];
  }
  return [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
