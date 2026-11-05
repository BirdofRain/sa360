/**
 * LAL AI BOT-1 VET defaults for a location that has the published snapshot.
 *
 * Workflow #8 Webform is discovered per location. The Onboarding Demo id is a
 * reference for that installation only. Existing destinations keep their saved
 * workflow, mode, and owner until an operator applies the demo retarget.
 * This module does not enable delivery and does not call GoHighLevel.
 */
import type { GhlDiscoveredCustomField, GhlDiscoveredUser } from "../ghl-config-discovery/ghl-config-discovery.types.js";
import type { CanonicalSourceAttributeKey } from "../source-intake/source-field-alias.registry.js";
import { parseSourceAttributeFieldMapJson } from "../source-intake/source-enrichment.service.js";
import type { SourceAttributeFieldMappingEntry } from "../source-intake/source-enrichment.types.js";
import { isValidGhlAssignedUserId } from "./ghl-delivery-request-builders.js";

/** Reference installation only. Other locations resolve their own workflow id. */
export const ONBOARDING_DEMO_VET_WEBFORM_WORKFLOW_ID = "bfab3c18-5e17-4dc6-b117-e1605ebe5d9c";

export const LAL_AI_BOT1_VET_WEBFORM_WORKFLOW_NAME =
  "8. New Contact Created (Set Timezone) → VET- Webform";

/** Tag the published #8 filters use. It is not added on contact creation. */
export const LAL_AI_BOT1_VET_TRIGGER_TAG = "vet";

const WEBFORM_NAME_NORMALIZED = normalizeWorkflowName(LAL_AI_BOT1_VET_WEBFORM_WORKFLOW_NAME);

/**
 * Survey fields inventoried on the VET webform snapshot. Names are matched
 * against the installed location. Native `contact.first_name` is not a custom
 * field; the contact upsert writes it as `firstName`.
 */
const VET_SNAPSHOT_FIELD_NAMES: ReadonlyArray<{
  canonical: CanonicalSourceAttributeKey;
  names: readonly string[];
}> = [
  { canonical: "primary_reason", names: ["Vet - Primary Reason", "Primary Reason"] },
  { canonical: "branch_of_service", names: ["vet - branch of service", "Branch of Service"] },
  { canonical: "military_status", names: ["vet - military status", "Military Status"] },
  { canonical: "marital_status", names: ["vet - marital status", "Marital Status"] },
  { canonical: "desired_coverage", names: ["vet - desired coverage", "Desired Coverage", "Desired Coverage Range"] },
  { canonical: "beneficiary", names: ["vet - beneficiary", "Beneficiary"] },
  { canonical: "disability_rating", names: ["vet - disability rating", "Disability Rating", "VA Disability Rating"] },
  { canonical: "best_time_to_call", names: ["vet - best time to call", "Best Time to Call"] },
  { canonical: "age", names: ["vet - age", "Age"] },
  { canonical: "sex", names: ["vet - sex", "Sex"] },
];

export type LalWorkflowCandidate = {
  id: string;
  name: string;
  status?: string | null;
};

export type LalPrimaryUserCandidate = {
  id: string;
  name?: string | null;
  role?: string | null;
  userType?: string | null;
  locationIds?: readonly string[] | null;
  isPrimary?: boolean | null;
};

export type LalAiBot1VetConfiguration = {
  applied: boolean;
  reason:
    | "new_destination"
    | "explicit_demo_retarget"
    | "existing_destination_preserved"
    | "explicit_workflow_override"
    | "explicit_mode_override"
    | "webform_not_unique";
  destinationWorkflowIdGhl: string | null;
  workflowTriggerMode: "direct_api" | null;
  opportunityCreationEnabled: false | null;
  defaultAssignedUserIdGhl: string | null;
  sourceAttributeFieldMap: Record<string, SourceAttributeFieldMappingEntry>;
  sourceEnrichmentPolicy: Record<string, unknown>;
  workflowName: string | null;
};

export function normalizeWorkflowName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[→⇒➔➜]/g, ">")
    .replace(/\s*->\s*/g, " > ")
    .replace(/\s*>\s*/g, " > ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLalAiBot1VetWebformWorkflow(workflow: LalWorkflowCandidate): boolean {
  return normalizeWorkflowName(workflow.name) === WEBFORM_NAME_NORMALIZED;
}

function publishedEnough(status: string | null | undefined, statusesPresent: boolean): boolean {
  const value = status?.trim().toLowerCase() ?? "";
  if (!value) return !statusesPresent;
  return value === "published" || value === "active";
}

/** The one published Webform #8 in this location. Leadform and drafts are ignored. */
export function discoverLalAiBot1VetWebformWorkflow(
  workflows: readonly LalWorkflowCandidate[]
): { id: string; name: string } | null {
  const statusesPresent = workflows.some((workflow) => Boolean(workflow.status?.trim()));
  const matches = workflows.filter(
    (workflow) =>
      workflow.id.trim() &&
      isLalAiBot1VetWebformWorkflow(workflow) &&
      publishedEnough(workflow.status, statusesPresent)
  );
  if (matches.length !== 1) return null;
  return { id: matches[0]!.id.trim(), name: matches[0]!.name };
}

export function isLiteralVetTriggerTag(tag: string): boolean {
  return tag.trim().toLowerCase() === LAL_AI_BOT1_VET_TRIGGER_TAG;
}

export function tagsWithoutLiteralVetTrigger(tags: readonly string[]): string[] {
  return tags.filter((tag) => !isLiteralVetTriggerTag(tag));
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function fieldLabels(field: GhlDiscoveredCustomField): string[] {
  return [field.name, field.key, field.fieldKey].filter((value): value is string => Boolean(value?.trim()));
}

/**
 * Fill canonical VET survey mappings that are not already saved.
 * A saved key is kept even when discovery would choose a different field.
 * Ambiguous location matches are left unset.
 */
export function mergeLalAiBot1VetSourceAttributeMap(input: {
  discoveredFields: readonly GhlDiscoveredCustomField[];
  saved: Record<string, SourceAttributeFieldMappingEntry>;
}): Record<string, SourceAttributeFieldMappingEntry> {
  const map: Record<string, SourceAttributeFieldMappingEntry> = { ...input.saved };
  for (const spec of VET_SNAPSHOT_FIELD_NAMES) {
    const saved = map[spec.canonical]?.ghlFieldKey?.trim();
    if (saved) continue;
    const wanted = new Set(spec.names.map(compact));
    const hits = input.discoveredFields.filter((field) =>
      fieldLabels(field).some((label) => wanted.has(compact(label)))
    );
    const uniqueIds = [...new Set(hits.map((field) => field.id.trim()).filter(Boolean))];
    if (uniqueIds.length !== 1) continue;
    map[spec.canonical] = { ghlFieldKey: uniqueIds[0]!, requirement: "optional" };
  }
  return map;
}

/**
 * Sub-account primary user.
 * An explicit location `primaryUserId` wins. Otherwise the unique account-type
 * owner, or the unique user flagged primary. Agency owners and the first listed
 * user are not selected.
 */
export function resolveSubaccountPrimaryUser(input: {
  locationId?: string | null;
  locationPrimaryUserId?: string | null;
  users: readonly LalPrimaryUserCandidate[];
}): string | null {
  const declared = input.locationPrimaryUserId?.trim() || null;
  if (declared && isValidGhlAssignedUserId(declared)) return declared;
  const locationId = input.locationId?.trim() || null;
  const owners = input.users.filter((user) => {
    const id = user.id?.trim();
    if (!id || !isValidGhlAssignedUserId(id)) return false;
    const type = user.userType?.trim().toLowerCase() ?? "";
    if (type === "agency") return false;
    const locations = (user.locationIds ?? []).map((value) => value.trim()).filter(Boolean);
    if (locationId && locations.length > 0 && !locations.includes(locationId)) return false;
    const role = user.role?.trim().toLowerCase() ?? "";
    return user.isPrimary === true || role === "owner";
  });
  const ids = [...new Set(owners.map((user) => user.id.trim()))];
  return ids.length === 1 ? ids[0]! : null;
}

function asPolicyRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

export function resolveLalAiBot1VetConfiguration(input: {
  existingWorkflowId?: string | null;
  existingWorkflowTriggerMode?: string | null;
  existingAssignedUserId?: string | null;
  requestedWorkflowId?: string | null;
  requestedWorkflowTriggerMode?: string | null;
  requestedAssignedUserId?: string | null;
  applyDemoRetarget?: boolean;
  workflows: readonly LalWorkflowCandidate[];
  users?: readonly LalPrimaryUserCandidate[];
  locationId?: string | null;
  locationPrimaryUserId?: string | null;
  discoveredFields?: readonly GhlDiscoveredCustomField[];
  savedSourceAttributeMap?: Record<string, SourceAttributeFieldMappingEntry>;
  savedPolicy?: unknown;
}): LalAiBot1VetConfiguration {
  const webform = discoverLalAiBot1VetWebformWorkflow(input.workflows);
  const savedMap = input.savedSourceAttributeMap ?? {};
  const savedPolicy = asPolicyRecord(input.savedPolicy);
  const preserved: LalAiBot1VetConfiguration = {
    applied: false,
    reason: "existing_destination_preserved",
    destinationWorkflowIdGhl: null,
    workflowTriggerMode: null,
    opportunityCreationEnabled: null,
    defaultAssignedUserIdGhl: null,
    sourceAttributeFieldMap: savedMap,
    sourceEnrichmentPolicy: savedPolicy,
    workflowName: webform?.name ?? null,
  };
  if (input.applyDemoRetarget === true) {
    if (!webform) return { ...preserved, reason: "webform_not_unique" };
    return appliedConfiguration(input, webform, "explicit_demo_retarget");
  }
  const requestedWorkflow = input.requestedWorkflowId?.trim() || null;
  if (requestedWorkflow) return { ...preserved, reason: "explicit_workflow_override" };
  const requestedMode = input.requestedWorkflowTriggerMode?.trim() || null;
  if (requestedMode && requestedMode !== "direct_api") {
    return { ...preserved, reason: "explicit_mode_override" };
  }
  if (input.existingWorkflowId?.trim()) return preserved;
  if (!webform) return { ...preserved, reason: "webform_not_unique" };
  return appliedConfiguration(input, webform, "new_destination");
}

function appliedConfiguration(
  input: {
    existingAssignedUserId?: string | null;
    requestedAssignedUserId?: string | null;
    users?: readonly LalPrimaryUserCandidate[];
    locationId?: string | null;
    locationPrimaryUserId?: string | null;
    discoveredFields?: readonly GhlDiscoveredCustomField[];
    savedSourceAttributeMap?: Record<string, SourceAttributeFieldMappingEntry>;
    savedPolicy?: unknown;
  },
  webform: { id: string; name: string },
  reason: "new_destination" | "explicit_demo_retarget"
): LalAiBot1VetConfiguration {
  const explicitOwner =
    input.requestedAssignedUserId?.trim() || input.existingAssignedUserId?.trim() || null;
  const primary = resolveSubaccountPrimaryUser({
    locationId: input.locationId,
    locationPrimaryUserId: input.locationPrimaryUserId,
    users: input.users ?? [],
  });
  const owner = explicitOwner || primary;
  const sourceAttributeFieldMap = mergeLalAiBot1VetSourceAttributeMap({
    discoveredFields: input.discoveredFields ?? [],
    saved: input.savedSourceAttributeMap ?? {},
  });
  const sourceEnrichmentPolicy = {
    ...asPolicyRecord(input.savedPolicy),
    lalAiBot1VetWebform: true,
    ...(primary ? { lalAiBot1PrimaryUserId: primary } : {}),
  };
  return {
    applied: true,
    reason,
    destinationWorkflowIdGhl: webform.id,
    workflowTriggerMode: "direct_api",
    opportunityCreationEnabled: false,
    defaultAssignedUserIdGhl: owner,
    sourceAttributeFieldMap,
    sourceEnrichmentPolicy,
    workflowName: webform.name,
  };
}

export function lalAiBot1VetSavePatch(input: {
  applyDemoRetarget?: boolean;
  existingWorkflowId?: string | null;
  existingWorkflowTriggerMode?: string | null;
  existingAssignedUserId?: string | null;
  requestedWorkflowId?: string | null;
  requestedWorkflowTriggerMode?: string | null;
  requestedAssignedUserId?: string | null;
  locationId?: string | null;
  locationPrimaryUserId?: string | null;
  workflows: readonly LalWorkflowCandidate[];
  users?: readonly LalPrimaryUserCandidate[];
  discoveredFields?: readonly GhlDiscoveredCustomField[];
  savedSourceAttributeMap?: unknown;
  requestedSourceAttributeMap?: unknown;
  savedPolicy?: unknown;
  requestedPolicy?: unknown;
}):
  | { ok: false; error: string; code: "LAL_WEBFORM_NOT_FOUND" }
  | { ok: true; configuration: LalAiBot1VetConfiguration } {
  const savedSourceAttributeMap = {
    ...parseSourceAttributeFieldMapJson(input.savedSourceAttributeMap),
    ...parseSourceAttributeFieldMapJson(input.requestedSourceAttributeMap),
  };
  const savedPolicy = {
    ...asPolicyRecord(input.savedPolicy),
    ...asPolicyRecord(input.requestedPolicy),
  };
  const configuration = resolveLalAiBot1VetConfiguration({
    existingWorkflowId: input.existingWorkflowId,
    existingWorkflowTriggerMode: input.existingWorkflowTriggerMode,
    existingAssignedUserId: input.existingAssignedUserId,
    requestedWorkflowId: input.requestedWorkflowId,
    requestedWorkflowTriggerMode: input.requestedWorkflowTriggerMode,
    requestedAssignedUserId: input.requestedAssignedUserId,
    applyDemoRetarget: input.applyDemoRetarget === true,
    workflows: input.workflows,
    users: input.users,
    locationId: input.locationId,
    locationPrimaryUserId: input.locationPrimaryUserId,
    discoveredFields: input.discoveredFields,
    savedSourceAttributeMap,
    savedPolicy,
  });
  if (input.applyDemoRetarget === true && !configuration.applied) {
    return {
      ok: false,
      error: "Published LAL AI BOT-1 VET Webform workflow #8 was not found for this location.",
      code: "LAL_WEBFORM_NOT_FOUND",
    };
  }
  return { ok: true, configuration };
}

export function lalPrimaryUserFromDiscoveredUser(user: GhlDiscoveredUser): LalPrimaryUserCandidate {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    userType: user.userType,
    locationIds: user.locationIds,
    isPrimary: user.isPrimary,
  };
}
