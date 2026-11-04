/**
 * VET location-API delivery contract.
 *
 * This plans contact, field, note, and workflow writes. It does not enable a
 * client, write Sheets, or repair stored leads. DOB values come from
 * `projectCampaignDobAge`. Existing destinations keep their stored
 * workflowTriggerMode. Direct API is only a proposal for a new supported
 * configuration until an operator saves it.
 *
 * Admin C.O.C. should read `vetWorkflowTriggerProposal` on the client
 * destination DTO and must not apply `proposedMode` onto an existing row.
 *
 * A required-write failure that blocks explicit enrollment also withholds
 * automation-entry tags (`SA360::EVENT::LEAD_CREATED`, `SA360::TRIGGER::NEW_LEAD`,
 * and `SA360::TRIGGER::AI_READY`) from the later routing-tag post. Niche, source,
 * and client tags still post. A GHL Contact Created trigger on the upsert is
 * outside this gate.
 */
import { projectCampaignDobAge } from "../consumer-age/campaign-dob-age.js";
import type { GhlDiscoveredCustomField } from "../ghl-config-discovery/ghl-config-discovery.types.js";
import {
  buildOnboardingLeadNote,
  type OnboardingLeadNotePlan,
} from "./onboarding-lead-note.js";
import {
  WORKFLOW_AI_READY_TAG,
  WORKFLOW_TRIGGER_MODE_DEFAULT,
  WORKFLOW_TRIGGER_TAG,
  normalizeWorkflowTriggerMode,
  type WorkflowTriggerMode,
} from "./ghl-workflow-trigger-mode.js";

export const VET_GHL_PROPOSED_WORKFLOW_TRIGGER_MODE = "direct_api" as const;

export const VET_NATIVE_CONTACT_KEYS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "address1",
  "city",
  "state",
  "postalCode",
  "country",
  "dateOfBirth",
  "source",
] as const;

export type VetNativeContactKey = (typeof VET_NATIVE_CONTACT_KEYS)[number];

export type VetOperation =
  | "contact"
  | "custom_fields"
  | "source_attributes"
  | "note"
  | "tags"
  | "workflow";

export type VetOperationOutcome =
  | "completed"
  | "failed_before_send"
  | "ambiguous"
  | "rejected"
  | "skipped";

export type VetOperationReceipt = {
  operation: VetOperation;
  idempotencyKey: string;
  outcome: VetOperationOutcome;
  externalId: string | null;
  httpStatus: number | null;
  /**
   * Automation-entry tags left off a completed routing-tag post because required
   * writes had already blocked enrollment. A later resume posts only these tags,
   * and only after that gate opens. Niche, source, and client tags are not listed.
   */
  withheldAutomationEntryTags?: string[];
};

export type VetRetryDecision = "execute" | "skip_completed" | "hold_ambiguous" | "hold_rejected";

export type VetDeliveryResults = {
  contact: "upserted" | "failed" | "replayed" | "ambiguous" | "rejected" | "not_attempted";
  note: "disabled" | "persisted" | "failed" | "ambiguous" | "rejected" | "skipped";
  workflow: "enrolled" | "not_enrolled" | "ambiguous" | "rejected" | "skipped" | "blocked" | "replayed";
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function vetWorkflowTriggerProposal(storedMode: string | null | undefined): {
  proposedMode: typeof VET_GHL_PROPOSED_WORKFLOW_TRIGGER_MODE;
  storedMode: string | null;
  changesExistingClients: false;
} {
  const stored = storedMode?.trim() || null;
  return {
    proposedMode: VET_GHL_PROPOSED_WORKFLOW_TRIGGER_MODE,
    storedMode: stored,
    changesExistingClients: false,
  };
}

/**
 * Stored mode wins, including the historical tag_trigger default.
 * A brand-new supported configuration may display direct_api, and this
 * function still refuses to write it.
 */
export function resolveStoredWorkflowTriggerMode(storedMode: string | null | undefined): WorkflowTriggerMode {
  if (storedMode === undefined || storedMode === null || storedMode.trim() === "") {
    return WORKFLOW_TRIGGER_MODE_DEFAULT;
  }
  return normalizeWorkflowTriggerMode(storedMode);
}

export function tagModePlan(input: {
  mode: WorkflowTriggerMode;
  extraTags?: string[];
}): {
  mode: WorkflowTriggerMode;
  tagWrite: "add_only" | "none";
  replacesExistingTags: false;
  tagsToAdd: string[];
  enrollsByDirectApi: boolean;
} {
  const extra = (input.extraTags ?? []).map((tag) => tag.trim()).filter(Boolean);
  if (input.mode === "tag_trigger") {
    const tagsToAdd = [WORKFLOW_TRIGGER_TAG, ...extra.filter((tag) => tag !== WORKFLOW_TRIGGER_TAG)];
    return {
      mode: input.mode,
      tagWrite: "add_only",
      replacesExistingTags: false,
      tagsToAdd,
      enrollsByDirectApi: false,
    };
  }
  return {
    mode: input.mode,
    tagWrite: "none",
    replacesExistingTags: false,
    tagsToAdd: [],
    enrollsByDirectApi: input.mode === "direct_api",
  };
}

/** Posted by the routing-tag step. A Contact Tag Added listener can start a workflow from this tag alone. */
export const AUTOMATION_ENTRY_EVENT_TAG = "SA360::EVENT::LEAD_CREATED";

const AUTOMATION_ENTRY_TAGS = new Set<string>([
  AUTOMATION_ENTRY_EVENT_TAG,
  WORKFLOW_TRIGGER_TAG,
  WORKFLOW_AI_READY_TAG,
]);

/**
 * Required-write failures block explicit enrollment. The same gate has to cover
 * a later tag post, or `SA360::EVENT::LEAD_CREATED` starts an automation while
 * `SA360::TRIGGER::NEW_LEAD` and direct API enrollment are skipped.
 * Niche, source, and client tags stay. This does not stop a GHL Contact Created
 * trigger on the earlier contact upsert.
 */
export function partitionRoutingTags(
  tags: readonly string[],
  blockAutomationEntry: boolean
): { tags: string[]; withheldAutomationEntryTags: string[] } {
  if (!blockAutomationEntry) return { tags: [...tags], withheldAutomationEntryTags: [] };
  const kept: string[] = [];
  const withheld: string[] = [];
  for (const tag of tags) {
    if (AUTOMATION_ENTRY_TAGS.has(tag)) withheld.push(tag);
    else kept.push(tag);
  }
  return { tags: kept, withheldAutomationEntryTags: withheld };
}

export function withheldAutomationEntryTags(receipt: VetOperationReceipt | null | undefined): string[] {
  const tags = receipt?.withheldAutomationEntryTags;
  if (!tags) return [];
  return tags.filter((tag) => AUTOMATION_ENTRY_TAGS.has(tag));
}

export type RoutingTagPreview = {
  method: "POST";
  path: "/contacts/:contactId/tags";
  locationId: string;
  tagWrite: "add_only";
  replacesExistingTags: false;
  sendsLead: false;
  /** Niche, source, and client tags. Automation-entry tags are never in this list. */
  tags: string[];
  automationEntry: {
    tag: typeof AUTOMATION_ENTRY_EVENT_TAG;
    disposition: "withheld" | "planned_if_required_writes_succeed";
    includedInThisPreviewPost: false;
  };
  withheldAutomationEntryTags: string[];
  detail: string;
};

/**
 * Simulation and shadow plans use this preview. The event tag is withheld when
 * the known write plan already blocks enrollment, and otherwise stays conditional
 * because a live required-write failure can still withhold it. The preview does
 * not send the tag.
 */
export function planRoutingTagPreview(input: {
  locationId: string;
  tags: readonly string[];
  blockAutomationEntry: boolean;
}): RoutingTagPreview {
  const split = partitionRoutingTags(input.tags, true);
  const withheld = input.blockAutomationEntry ? split.withheldAutomationEntryTags : [];
  const detail = input.blockAutomationEntry
    ? "SA360::EVENT::LEAD_CREATED is withheld because the write plan blocks enrollment. This preview does not send it."
    : "SA360::EVENT::LEAD_CREATED is planned only if required writes succeed. This preview does not send it. A later required-write failure withholds it. A Contact Created trigger on the contact upsert is separate and is not verified here.";
  return {
    method: "POST",
    path: "/contacts/:contactId/tags",
    locationId: input.locationId,
    tagWrite: "add_only",
    replacesExistingTags: false,
    sendsLead: false,
    tags: split.tags,
    automationEntry: {
      tag: AUTOMATION_ENTRY_EVENT_TAG,
      disposition: input.blockAutomationEntry ? "withheld" : "planned_if_required_writes_succeed",
      includedInThisPreviewPost: false,
    },
    withheldAutomationEntryTags: withheld,
    detail,
  };
}

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function contactBag(payload: unknown): Record<string, unknown> | null {
  return asRecord(asRecord(payload)?.contact);
}

export function nativeDateOfBirthForContact(input: {
  normalizedPayload?: unknown;
  sourceAttributes?: Record<string, unknown> | null;
  receivedAt?: string | null;
}): string | null {
  const payload =
    input.normalizedPayload ??
    (input.sourceAttributes
      ? { routing: { source_intake: { sourceAttributes: input.sourceAttributes } } }
      : null);
  if (payload == null) return null;
  const projected = projectCampaignDobAge({
    normalizedPayload: payload,
    receivedAt: input.receivedAt,
  });
  const dob = projected.dateOfBirth.trim();
  return ISO_DATE.test(dob) ? dob : null;
}

export function vetNativeContactFields(input: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  dateOfBirth?: string | null;
  source?: string | null;
  normalizedPayload?: unknown;
  sourceAttributes?: Record<string, unknown> | null;
  receivedAt?: string | null;
}): Record<string, string | null> {
  const contact = contactBag(input.normalizedPayload);
  const address1 =
    trimmed(input.address1) ??
    trimmed(contact?.address1) ??
    trimmed(contact?.address) ??
    trimmed(contact?.street);
  const dateOfBirth =
    (input.dateOfBirth && ISO_DATE.test(input.dateOfBirth.trim()) ? input.dateOfBirth.trim() : null) ??
    nativeDateOfBirthForContact(input);
  return {
    firstName: trimmed(input.firstName) ?? trimmed(contact?.first_name),
    lastName: trimmed(input.lastName) ?? trimmed(contact?.last_name),
    email: trimmed(input.email) ?? trimmed(contact?.email),
    phone: trimmed(input.phone) ?? trimmed(contact?.phone_e164) ?? trimmed(contact?.phone),
    address1,
    city: trimmed(input.city) ?? trimmed(contact?.city),
    state: trimmed(input.state) ?? trimmed(contact?.state),
    postalCode: trimmed(input.postalCode) ?? trimmed(contact?.zip) ?? trimmed(contact?.postalCode),
    country: trimmed(input.country) ?? trimmed(contact?.country),
    dateOfBirth,
    source: trimmed(input.source),
  };
}

/** Copy only non-empty native fields. Empty values are omitted so a later upsert cannot clear them. */
export function nativeContactHttpFields(fields: Record<string, string | null | undefined>): Record<string, string> {
  const body: Record<string, string> = {};
  for (const key of VET_NATIVE_CONTACT_KEYS) {
    const value = trimmed(fields[key]);
    if (!value) continue;
    if (key === "dateOfBirth" && !ISO_DATE.test(value)) continue;
    body[key] = value;
  }
  return body;
}

export type VetNativeFieldDisposition = "send" | "omitted_missing" | "invalid";

export type VetNativeFieldPlanRow = {
  key: VetNativeContactKey;
  disposition: VetNativeFieldDisposition;
  value: string | null;
};

export type VetNativeFieldPlan = {
  fields: VetNativeFieldPlanRow[];
  /** Delivery does not write native Timezone or sa360_timezone. */
  timezoneWritten: false;
};

function rawDateCandidate(input: Parameters<typeof vetNativeContactFields>[0]): string | null {
  const direct = trimmed(input.dateOfBirth);
  if (direct) return direct;
  const contact = contactBag(input.normalizedPayload);
  const fromContact = trimmed(contact?.dateOfBirth);
  if (fromContact) return fromContact;
  const fromAttributes = trimmed(input.sourceAttributes?.date_of_birth);
  if (fromAttributes) return fromAttributes;
  const routing = asRecord(asRecord(input.normalizedPayload)?.routing);
  const intake = asRecord(routing?.source_intake);
  return trimmed(asRecord(intake?.sourceAttributes)?.date_of_birth);
}

/**
 * Native contact projection used by the live upsert. Age is not a native field.
 * Invalid dates stay off the body; this does not add a second DOB parser.
 */
export function presentNativeContactPlan(input: Parameters<typeof vetNativeContactFields>[0]): VetNativeFieldPlan {
  const projected = vetNativeContactFields(input);
  const httpBody = nativeContactHttpFields(projected);
  const rawDate = rawDateCandidate(input);
  return {
    timezoneWritten: false,
    fields: VET_NATIVE_CONTACT_KEYS.map((key) => {
      const value = httpBody[key] ?? null;
      if (value) return { key, disposition: "send" as const, value };
      if (key === "dateOfBirth" && rawDate && !projected.dateOfBirth) {
        return { key, disposition: "invalid" as const, value: null };
      }
      return { key, disposition: "omitted_missing" as const, value: null };
    }),
  };
}

export type LocationFieldCollision = {
  fieldId: string;
  fieldName: string | null;
  canonicalKeys: string[];
};

export type LocationCustomFieldValidation = {
  collisions: LocationFieldCollision[];
  unresolvedDeliveryRequired: string[];
  /** Canonical keys that have a value and a single location field. */
  writableKeys: string[];
};

/**
 * Two canonical keys that resolve to one location field are a duplicate target.
 * Neither value is writable. A delivery_required key that is missing, unmapped,
 * or colliding stays unresolved and must not be sent as a blank.
 */
export function validateLocationCustomFieldTargets(input: {
  fieldMap: Record<string, { ghlFieldKey: string; requirement?: string | null }>;
  discoveredFields: readonly GhlDiscoveredCustomField[];
  values: Record<string, string | null | undefined>;
  unmappedKeys?: readonly string[];
  missingSourceKeys?: readonly string[];
}): LocationCustomFieldValidation {
  const byId = new Map<string, GhlDiscoveredCustomField>();
  const byKey = new Map<string, GhlDiscoveredCustomField>();
  for (const field of input.discoveredFields) {
    if (field.id?.trim()) byId.set(field.id.trim(), field);
    for (const key of [field.fieldKey, field.key]) {
      if (!key?.trim()) continue;
      byKey.set(key.trim(), field);
      byKey.set(key.trim().toLowerCase(), field);
    }
  }

  const owners = new Map<string, { field: GhlDiscoveredCustomField; keys: string[] }>();
  for (const [canonical, entry] of Object.entries(input.fieldMap)) {
    const token = entry.ghlFieldKey?.trim();
    if (!token) continue;
    const field = byId.get(token) ?? byKey.get(token) ?? byKey.get(token.toLowerCase());
    if (!field?.id) continue;
    const value = trimmed(input.values[canonical]);
    if (!value) continue;
    const current = owners.get(field.id) ?? { field, keys: [] };
    current.keys.push(canonical);
    owners.set(field.id, current);
  }

  const collisions: LocationFieldCollision[] = [];
  const writableKeys: string[] = [];
  for (const [fieldId, owner] of owners) {
    if (owner.keys.length > 1) {
      collisions.push({
        fieldId,
        fieldName: owner.field.name?.trim() || null,
        canonicalKeys: [...owner.keys],
      });
      continue;
    }
    writableKeys.push(owner.keys[0]!);
  }

  const collided = new Set(collisions.flatMap((collision) => collision.canonicalKeys));
  const unmapped = new Set(input.unmappedKeys ?? []);
  const missing = new Set(input.missingSourceKeys ?? []);
  const unresolvedDeliveryRequired: string[] = [];
  for (const [canonical, entry] of Object.entries(input.fieldMap)) {
    if (entry.requirement !== "delivery_required") continue;
    if (collided.has(canonical) || unmapped.has(canonical) || missing.has(canonical) || !writableKeys.includes(canonical)) {
      unresolvedDeliveryRequired.push(canonical);
    }
  }

  return { collisions, unresolvedDeliveryRequired, writableKeys };
}

export function workflowEnrollmentAllowed(input: {
  contactCompleted: boolean;
  requiredCustomFieldStampFailed: boolean;
  collisions: readonly LocationFieldCollision[];
  unresolvedDeliveryRequired: readonly string[];
}): { allowed: boolean; reason: string | null } {
  if (!input.contactCompleted) {
    return { allowed: false, reason: "Workflow enrollment waits until the contact upsert completes." };
  }
  if (input.requiredCustomFieldStampFailed) {
    return { allowed: false, reason: "Workflow enrollment waits until required custom field writes succeed." };
  }
  if (input.collisions.length > 0) {
    const labels = input.collisions
      .map((collision) => `${collision.canonicalKeys.join(" + ")} → ${collision.fieldName ?? collision.fieldId}`)
      .join("; ");
    return { allowed: false, reason: `Duplicate custom field targets block workflow enrollment: ${labels}.` };
  }
  if (input.unresolvedDeliveryRequired.length > 0) {
    return {
      allowed: false,
      reason: `Required source fields were not written: ${input.unresolvedDeliveryRequired.join(", ")}.`,
    };
  }
  return { allowed: true, reason: null };
}

export function classifyRemoteOutcome(input: {
  attempted: boolean;
  httpStatus: number | null;
  ok: boolean;
  externalId: string | null;
  requiresExternalId: boolean;
}): VetOperationOutcome {
  if (!input.attempted) return "failed_before_send";
  const status = input.httpStatus ?? 0;
  if (status === 0 || status >= 500) return "ambiguous";
  if (input.ok && input.requiresExternalId && !input.externalId?.trim()) return "ambiguous";
  if (input.ok) return "completed";
  if (status >= 400 && status < 500) return "rejected";
  return "ambiguous";
}

export function operationIdempotencyKey(runKey: string, operation: VetOperation, part?: number): string {
  const base = `${runKey.trim()}:${operation}`;
  return part === undefined ? base : `${base}:${part}`;
}

export function retryDecision(receipt: VetOperationReceipt | null | undefined): VetRetryDecision {
  if (!receipt) return "execute";
  if (receipt.outcome === "completed") return "skip_completed";
  if (receipt.outcome === "ambiguous") return "hold_ambiguous";
  if (receipt.outcome === "rejected") return "hold_rejected";
  return "execute";
}

const STEP_OPERATION: Record<string, VetOperation> = {
  create_or_update_contact: "contact",
  stamp_custom_fields: "custom_fields",
  stamp_source_attributes: "source_attributes",
  write_intake_summary_note: "note",
  add_tags: "tags",
  start_workflow: "workflow",
};

const OPERATION_NAMES = new Set<VetOperation>([
  "contact",
  "custom_fields",
  "source_attributes",
  "note",
  "tags",
  "workflow",
]);

const OUTCOME_NAMES = new Set<VetOperationOutcome>([
  "completed",
  "failed_before_send",
  "ambiguous",
  "rejected",
  "skipped",
]);

function storedReceipt(value: unknown): VetOperationReceipt | null {
  const record = asRecord(value);
  const receipt = asRecord(record?.vetOperationReceipt);
  if (!receipt) return null;
  const operation = receipt.operation;
  const outcome = receipt.outcome;
  if (typeof operation !== "string" || !OPERATION_NAMES.has(operation as VetOperation)) return null;
  if (typeof outcome !== "string" || !OUTCOME_NAMES.has(outcome as VetOperationOutcome)) return null;
  const withheld = Array.isArray(receipt.withheldAutomationEntryTags)
    ? receipt.withheldAutomationEntryTags.filter(
        (tag): tag is string => typeof tag === "string" && AUTOMATION_ENTRY_TAGS.has(tag)
      )
    : [];
  return {
    operation: operation as VetOperation,
    idempotencyKey: typeof receipt.idempotencyKey === "string" ? receipt.idempotencyKey : "",
    outcome: outcome as VetOperationOutcome,
    externalId: typeof receipt.externalId === "string" ? receipt.externalId : null,
    httpStatus: typeof receipt.httpStatus === "number" ? receipt.httpStatus : null,
    ...(withheld.length > 0 ? { withheldAutomationEntryTags: withheld } : {}),
  };
}

export function receiptFromPersistedStep(step: {
  stepType?: string | null;
  status?: string | null;
  externalId?: string | null;
  errorCode?: string | null;
  responseRedactedJson?: unknown;
}): VetOperationReceipt | null {
  const stored = storedReceipt(step.responseRedactedJson);
  if (stored) return stored;
  const operation = step.stepType ? STEP_OPERATION[step.stepType] : undefined;
  if (!operation) {
    const response = asRecord(step.responseRedactedJson);
    const executed = response?.externalCallExecuted === true || (step.errorCode ?? "").startsWith("http_");
    if (!executed) return null;
    const code = step.errorCode ?? "";
    const outcome: VetOperationOutcome =
      code === "http_transport" || code === "http_0" || /^http_5\d\d$/.test(code)
        ? "ambiguous"
        : /^http_4\d\d$/.test(code)
          ? "rejected"
          : "ambiguous";
    return {
      operation: "contact",
      idempotencyKey: "",
      outcome,
      externalId: step.externalId ?? null,
      httpStatus: null,
    };
  }
  const response = asRecord(step.responseRedactedJson);
  const executed = response?.externalCallExecuted === true;
  const status = step.status ?? "";
  if (status === "skipped" || status === "blocked") {
    return { operation, idempotencyKey: "", outcome: "skipped", externalId: step.externalId ?? null, httpStatus: null };
  }
  if ((status === "succeeded" || status === "partial_success") && operation === "contact" && !step.externalId?.trim()) {
    return { operation, idempotencyKey: "", outcome: "ambiguous", externalId: null, httpStatus: null };
  }
  if (status === "succeeded" || status === "partial_success") {
    return {
      operation,
      idempotencyKey: "",
      outcome: "completed",
      externalId: step.externalId ?? null,
      httpStatus: null,
    };
  }
  if (!executed && !(step.errorCode ?? "").startsWith("http_")) {
    return {
      operation,
      idempotencyKey: "",
      outcome: "failed_before_send",
      externalId: null,
      httpStatus: null,
    };
  }
  const code = step.errorCode ?? "";
  const outcome: VetOperationOutcome =
    code === "http_transport" || code === "http_0" || /^http_5\d\d$/.test(code) || status === "optional_failed"
      ? code.startsWith("http_4")
        ? "rejected"
        : "ambiguous"
      : code.startsWith("http_4")
        ? "rejected"
        : "ambiguous";
  return { operation, idempotencyKey: "", outcome, externalId: step.externalId ?? null, httpStatus: null };
}

export type DeliveryRetryDisposition = "create" | "retry" | "resume" | "hold";

export function deliveryRetryDisposition(run: {
  status: string;
  stepRuns: Array<{
    stepType?: string | null;
    status?: string | null;
    externalId?: string | null;
    errorCode?: string | null;
    responseRedactedJson?: unknown;
  }>;
} | null): DeliveryRetryDisposition {
  if (!run) return "create";
  if (
    run.status === "succeeded" ||
    run.status === "partial_success" ||
    run.status === "executing" ||
    run.status === "skipped_duplicate"
  ) {
    return "hold";
  }
  if (run.status !== "failed") return "hold";
  if (run.stepRuns.length === 0) return "hold";
  const receipts = run.stepRuns
    .map((step) => receiptFromPersistedStep(step))
    .filter((receipt): receipt is VetOperationReceipt => Boolean(receipt));
  if (receipts.length === 0) return "retry";
  if (receipts.some((receipt) => receipt.outcome === "ambiguous" || receipt.outcome === "rejected")) return "hold";
  const completed = receipts.some((receipt) => receipt.outcome === "completed");
  const retryable = receipts.every(
    (receipt) => receipt.outcome === "failed_before_send" || receipt.outcome === "skipped" || receipt.outcome === "completed"
  );
  if (!retryable) return "hold";
  if (completed) return "resume";
  if (receipts.some((receipt) => receipt.outcome === "failed_before_send")) return "retry";
  return "hold";
}

export function separateDeliveryResults(
  steps: Array<{ stepType: string; status: string; responseRedactedJson?: unknown }>
): VetDeliveryResults {
  const receiptOf = (stepType: string) => {
    const step = steps.find((item) => item.stepType === stepType);
    if (!step) return null;
    return storedReceipt(step.responseRedactedJson) ?? receiptFromPersistedStep(step);
  };
  const contact = receiptOf("create_or_update_contact");
  const noteStep = steps.find((step) => step.stepType === "write_intake_summary_note");
  const note = noteStep ? receiptOf("write_intake_summary_note") : null;
  const workflow = receiptOf("start_workflow");
  const workflowStep = steps.find((step) => step.stepType === "start_workflow");

  const contactResult: VetDeliveryResults["contact"] = !contact
    ? "not_attempted"
    : contact.outcome === "completed" && asRecord(steps.find((step) => step.stepType === "create_or_update_contact")?.responseRedactedJson)?.replayedFromReceipt === true
      ? "replayed"
      : contact.outcome === "completed"
        ? "upserted"
        : contact.outcome === "ambiguous"
          ? "ambiguous"
          : contact.outcome === "rejected"
            ? "rejected"
            : "failed";

  const noteResult: VetDeliveryResults["note"] = !noteStep
    ? "disabled"
    : note?.outcome === "completed"
      ? "persisted"
      : note?.outcome === "ambiguous"
        ? "ambiguous"
        : note?.outcome === "rejected"
          ? "rejected"
          : note?.outcome === "skipped"
            ? "skipped"
            : "failed";

  const workflowResponse = asRecord(workflowStep?.responseRedactedJson);
  let workflowResult: VetDeliveryResults["workflow"] = "not_enrolled";
  if (!workflowStep) {
    workflowResult = "not_enrolled";
  } else if (workflowResponse?.workflowBlocked === true) {
    workflowResult = "blocked";
  } else if (workflow?.outcome === "completed" && workflowResponse?.replayedFromReceipt === true) {
    workflowResult = "replayed";
  } else if (workflow?.outcome === "completed") {
    workflowResult = "enrolled";
  } else if (workflow?.outcome === "ambiguous") {
    workflowResult = "ambiguous";
  } else if (workflow?.outcome === "rejected") {
    workflowResult = "rejected";
  } else if (workflow?.outcome === "skipped" || workflowStep.status === "skipped") {
    workflowResult = "skipped";
  } else {
    workflowResult = "not_enrolled";
  }

  return { contact: contactResult, note: noteResult, workflow: workflowResult };
}

export function planIntakeSummaryNote(input: {
  enabled: boolean;
  sourceLeadEventId: string;
  clientAccountId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  state?: string | null;
  leadType?: string | null;
  sourceAttributes?: Record<string, unknown> | null;
  generatedAt?: string | null;
  idempotencyKey: string;
}): { enabled: false; reason: "disabled" } | { enabled: true; plan: OnboardingLeadNotePlan } | { enabled: true; error: string } {
  if (input.enabled !== true) return { enabled: false, reason: "disabled" };
  const attributes = { ...(input.sourceAttributes ?? {}) };
  const projected = nativeDateOfBirthForContact({
    sourceAttributes: attributes,
    receivedAt: input.generatedAt,
  });
  if (projected) attributes.date_of_birth = projected;
  const built = buildOnboardingLeadNote({
    event: {
      sourceLeadEventId: input.sourceLeadEventId,
      clientAccountId: input.clientAccountId,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      email: input.email,
      state: input.state,
      leadType: input.leadType,
      sourceAttributes: attributes,
      generatedAt: input.generatedAt,
    },
    clientAccountId: input.clientAccountId,
  });
  if (!built.ok) return { enabled: true, error: built.error };
  if (built.status === "note_too_long") return { enabled: true, error: "note_too_long" };
  return {
    enabled: true,
    plan: {
      ...built,
      parts: built.parts.map((part, index) => ({
        ...part,
        idempotencyKey: operationIdempotencyKey(input.idempotencyKey, "note", index + 1),
      })),
    },
  };
}

export function noteIdFromResponse(json: unknown): string | null {
  const root = asRecord(json);
  if (!root) return null;
  const note = asRecord(root.note);
  const nested = trimmed(note?.id);
  if (nested) return nested;
  return trimmed(root.id) ?? trimmed(root.noteId);
}
