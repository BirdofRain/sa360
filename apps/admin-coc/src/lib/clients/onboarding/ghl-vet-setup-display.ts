/**
 * Operator reading of a saved GHL destination.
 * Field names and write dispositions come from discovered fields or from the
 * backend write plan. This module does not normalize dates of birth, invent
 * destination ids, or decide that distinct ids are correct.
 */

export const VET_REVIEW_KEYS = ["desired_coverage", "branch_of_service", "primary_reason"] as const;

/** Native contact keys the live upsert can send. Timezone is not one of them. */
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

export const VET_NATIVE_FIELD_LABELS: Record<(typeof VET_NATIVE_CONTACT_KEYS)[number], string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  address1: "Address",
  city: "City",
  state: "State",
  postalCode: "Postal code",
  country: "Country",
  dateOfBirth: "Native date of birth",
  source: "Source",
};

export const CONTACT_ONLY_TEST_GAP =
  "No contact-only GHL test is available. Run one GHL test uses the saved workflow mode and can enroll a workflow. Ongoing mode none is not a contact-only test. It blocks ongoing GHL writes.";

export const WORKFLOW_SEPARATION_COPY =
  "Contact creation or update and workflow entry are separate steps. Saving this configuration does not send a lead, enroll a contact, or turn delivery on.";

export const TAG_DOES_NOT_PROVE_ENROLLMENT =
  "Submitting a tag does not prove the workflow enrolled. direct_api reports an accepted enrollment when the workflow call succeeds. That is not verification that the workflow ran inside GoHighLevel.";

export const GHL_TRIGGER_UNVERIFIED =
  "A GoHighLevel Contact Created trigger, or a trigger on a routing tag, has to be checked in GoHighLevel. This screen cannot guarantee those triggers are absent.";

const SUGGESTION_LABELS: Record<string, readonly string[]> = {
  desired_coverage: ["desired coverage range", "desired coverage", "vet desired coverage"],
  branch_of_service: ["branch of service", "vet branch of service"],
  primary_reason: ["primary reason", "vet primary reason"],
  applied_for_other_insurance: ["applied for other insurance", "vot applied for other insurance"],
};

const COMPATIBLE_FIELD_TYPES = new Set([
  "TEXT",
  "LARGE_TEXT",
  "SINGLE_OPTIONS",
  "MULTIPLE_OPTIONS",
  "RADIO",
  "CHECKBOX",
  "NUMERICAL",
  "FLOAT",
  "MONETARY",
  "MONETORY",
  "TEXTBOX_LIST",
]);

export type DiscoveredDestinationField = {
  id: string;
  name: string;
  key?: string | null;
  fieldKey?: string | null;
  dataType?: string | null;
};

export type SavedMappingEntry = {
  ghlFieldKey: string;
  requirement: "optional" | "automation_required" | "delivery_required" | "ignored";
};

export type MappingReviewStatus = "saved" | "missing" | "stale" | "unavailable";

export type MappingReviewRow = {
  key: string;
  savedId: string | null;
  fieldName: string | null;
  status: MappingReviewStatus;
  requirement: SavedMappingEntry["requirement"] | null;
};

export type DuplicateTarget = {
  fieldId: string;
  fieldName: string | null;
  keys: string[];
};

export type FieldSuggestion = {
  key: string;
  status: "one" | "ambiguous" | "none";
  fields: Array<{ id: string; name: string; typeUnverified: boolean }>;
};

export type NativePreviewRow = {
  key: string;
  label: string;
  disposition: "send" | "omitted_missing" | "invalid" | "not_in_plan";
  value: string | null;
};

export type CustomPreviewRow = {
  key: string;
  fieldId: string | null;
  fieldName: string | null;
  disposition: "send" | "omitted_missing" | "unmapped" | "invalid" | "blocked" | "unavailable";
  value: string | null;
};

export type VetWritePlanView = {
  native: NativePreviewRow[];
  customFields: CustomPreviewRow[];
  enrollmentAllowed: boolean | null;
  enrollmentReason: string | null;
  timezoneWritten: false;
  noteEnabled: boolean | null;
  noteContract: string | null;
  notePreview: string | null;
  noteError: string | null;
  sendsLead: false;
};

const REQUIREMENTS = new Set(["optional", "automation_required", "delivery_required", "ignored"]);

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function savedMappingEntries(raw: unknown): Record<string, SavedMappingEntry> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, SavedMappingEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const canonical = key.trim();
    if (!canonical) continue;
    if (typeof value === "string" && value.trim()) {
      out[canonical] = { ghlFieldKey: value.trim(), requirement: "optional" };
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const ghlFieldKey =
      (typeof record.ghlFieldKey === "string" && record.ghlFieldKey.trim()) ||
      (typeof record.ghlFieldId === "string" && record.ghlFieldId.trim()) ||
      "";
    if (!ghlFieldKey) continue;
    const requirement = typeof record.requirement === "string" ? record.requirement : "optional";
    out[canonical] = {
      ghlFieldKey,
      requirement: REQUIREMENTS.has(requirement) ? (requirement as SavedMappingEntry["requirement"]) : "optional",
    };
  }
  return out;
}

export function intakeSummaryNotesEnabled(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return (raw as Record<string, unknown>).intakeSummaryNotesEnabled === true;
}

/** Keep every other policy key. Only an explicit true enables notes. */
export function mergeIntakeSummaryNotes(raw: unknown, enabled: boolean): Record<string, unknown> {
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  base.intakeSummaryNotesEnabled = enabled === true;
  return base;
}

function resolvedField(
  savedId: string,
  fields: readonly DiscoveredDestinationField[]
): DiscoveredDestinationField | null {
  return (
    fields.find((field) => field.id === savedId || field.fieldKey === savedId || field.key === savedId) ?? null
  );
}

export function reviewSavedMappings(input: {
  entries: Record<string, SavedMappingEntry>;
  keys: readonly string[];
  fields: readonly DiscoveredDestinationField[];
  discoveryLoaded: boolean;
}): MappingReviewRow[] {
  return input.keys.map((key) => {
    const entry = input.entries[key];
    const savedId = entry?.ghlFieldKey ?? null;
    if (!savedId) {
      return { key, savedId: null, fieldName: null, status: "missing", requirement: entry?.requirement ?? null };
    }
    if (!input.discoveryLoaded) {
      return { key, savedId, fieldName: null, status: "saved", requirement: entry?.requirement ?? null };
    }
    if (input.fields.length === 0) {
      return { key, savedId, fieldName: null, status: "unavailable", requirement: entry?.requirement ?? null };
    }
    const field = resolvedField(savedId, input.fields);
    if (!field) {
      return { key, savedId, fieldName: null, status: "stale", requirement: entry?.requirement ?? null };
    }
    return {
      key,
      savedId: field.id,
      fieldName: field.name,
      status: "saved",
      requirement: entry?.requirement ?? null,
    };
  });
}

export function duplicateTargets(input: {
  entries: Record<string, SavedMappingEntry>;
  fields: readonly DiscoveredDestinationField[];
}): DuplicateTarget[] {
  const groups = new Map<string, { fieldName: string | null; keys: string[] }>();
  for (const [key, entry] of Object.entries(input.entries)) {
    const token = entry.ghlFieldKey.trim();
    if (!token || entry.requirement === "ignored") continue;
    const field = resolvedField(token, input.fields);
    const fieldId = field?.id ?? token;
    const current = groups.get(fieldId) ?? { fieldName: field?.name ?? null, keys: [] };
    current.keys.push(key);
    if (field?.name) current.fieldName = field.name;
    groups.set(fieldId, current);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.keys.length > 1)
    .map(([fieldId, group]) => ({ fieldId, fieldName: group.fieldName, keys: group.keys }));
}

export function enrollmentBlockers(input: {
  entries: Record<string, SavedMappingEntry>;
  duplicates: readonly DuplicateTarget[];
  sourceValues?: Record<string, string | null> | null;
  discoveryLoaded: boolean;
  fields: readonly DiscoveredDestinationField[];
}): string[] {
  const blockers: string[] = [];
  const values = input.sourceValues;
  for (const duplicate of input.duplicates) {
    const valued = values
      ? duplicate.keys.filter((key) => Boolean(values[key]?.trim()))
      : duplicate.keys;
    if (!values || valued.length > 1) {
      blockers.push(
        `Duplicate custom field target ${duplicate.fieldName ?? duplicate.fieldId} is shared by ${duplicate.keys.join(", ")}. Workflow enrollment is blocked when more than one of those keys has a value.`
      );
    }
  }
  if (!input.discoveryLoaded) return blockers;
  for (const [key, entry] of Object.entries(input.entries)) {
    if (entry.requirement !== "delivery_required") continue;
    const review = reviewSavedMappings({
      entries: input.entries,
      keys: [key],
      fields: input.fields,
      discoveryLoaded: true,
    })[0];
    const blank = values ? !values[key]?.trim() : false;
    const collided = input.duplicates.some((duplicate) => duplicate.keys.includes(key));
    if (!review || review.status !== "saved" || blank || collided) {
      blockers.push(`Required source field ${key} was not written.`);
    }
  }
  return blockers;
}

export function fieldSuggestions(input: {
  key: string;
  fields: readonly DiscoveredDestinationField[];
}): FieldSuggestion {
  const labels = SUGGESTION_LABELS[input.key];
  if (!labels) return { key: input.key, status: "none", fields: [] };
  const matches = input.fields.flatMap((field) => {
    if (!field.id || !labels.includes(normalizeLabel(field.name))) return [];
    const type = field.dataType?.trim().toUpperCase() || null;
    if (type && !COMPATIBLE_FIELD_TYPES.has(type)) return [];
    return [{ id: field.id, name: field.name, typeUnverified: type === null }];
  });
  if (matches.length === 0) return { key: input.key, status: "none", fields: [] };
  if (matches.length > 1 || matches.some((match) => match.typeUnverified)) {
    return { key: input.key, status: "ambiguous", fields: matches };
  }
  return { key: input.key, status: "one", fields: matches };
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const NATIVE_DISPOSITIONS = new Set(["send", "omitted_missing", "invalid"]);
const CUSTOM_DISPOSITIONS = new Set(["send", "omitted_missing", "unmapped", "invalid", "blocked", "unavailable"]);

export function readVetWritePlan(requestPreviewJson: unknown): VetWritePlanView | null {
  const root = record(requestPreviewJson);
  const plan = record(root?.vetWritePlan);
  if (!plan) return null;
  const nativePlan = record(plan.native);
  const nativeRows = Array.isArray(nativePlan?.fields) ? nativePlan.fields : [];
  const native: NativePreviewRow[] = [];
  for (const key of VET_NATIVE_CONTACT_KEYS) {
    const row = nativeRows.map(record).find((item) => item?.key === key);
    const disposition = typeof row?.disposition === "string" ? row.disposition : "not_in_plan";
    native.push({
      key,
      label: VET_NATIVE_FIELD_LABELS[key],
      disposition: NATIVE_DISPOSITIONS.has(disposition)
        ? (disposition as NativePreviewRow["disposition"])
        : "not_in_plan",
      value: typeof row?.value === "string" ? row.value : null,
    });
  }
  const customFields: CustomPreviewRow[] = [];
  if (Array.isArray(plan.customFields)) {
    for (const item of plan.customFields) {
      const row = record(item);
      if (!row || typeof row.key !== "string") continue;
      const disposition = typeof row.disposition === "string" ? row.disposition : "";
      if (!CUSTOM_DISPOSITIONS.has(disposition)) continue;
      customFields.push({
        key: row.key,
        fieldId: typeof row.fieldId === "string" ? row.fieldId : null,
        fieldName: typeof row.fieldName === "string" ? row.fieldName : null,
        disposition: disposition as CustomPreviewRow["disposition"],
        value: typeof row.value === "string" ? row.value : null,
      });
    }
  }
  const enrollment = record(plan.enrollment);
  const note = record(plan.note);
  return {
    native,
    customFields,
    enrollmentAllowed: typeof enrollment?.allowed === "boolean" ? enrollment.allowed : null,
    enrollmentReason: typeof enrollment?.reason === "string" ? enrollment.reason : null,
    timezoneWritten: false,
    noteEnabled: typeof note?.enabled === "boolean" ? note.enabled : null,
    noteContract: typeof note?.contractVersion === "string" ? note.contractVersion : null,
    notePreview: typeof note?.preview === "string" ? note.preview : null,
    noteError: typeof note?.error === "string" ? note.error : null,
    sendsLead: false,
  };
}

export type SeparatedOperationResults = {
  contact: string | null;
  note: string | null;
  workflow: string | null;
  blindRetry: false;
  lines: string[];
};

const CONTACT_COPY: Record<string, string> = {
  upserted: "Contact upsert was accepted.",
  failed: "Contact upsert failed before a separated success.",
  replayed: "Contact upsert was already completed and was not repeated.",
  ambiguous: "Contact upsert is ambiguous. It is not retried from this screen.",
  rejected: "Contact upsert was rejected. It is not retried from this screen.",
  not_attempted: "Contact upsert was not attempted.",
};

const NOTE_COPY: Record<string, string> = {
  disabled: "Intake-summary note is off.",
  persisted: "Intake-summary note was accepted.",
  failed: "Intake-summary note failed. The contact and workflow results stay separate.",
  ambiguous: "Intake-summary note is ambiguous. It is not retried from this screen.",
  rejected: "Intake-summary note was rejected. It is not retried from this screen.",
  skipped: "Intake-summary note was skipped.",
};

const WORKFLOW_COPY: Record<string, string> = {
  enrolled: "Workflow enrollment was accepted. That does not verify the workflow ran inside GoHighLevel.",
  not_enrolled: "Workflow was not enrolled.",
  ambiguous: "Workflow enrollment is ambiguous. It is not retried from this screen.",
  rejected: "Workflow enrollment was rejected. It is not retried from this screen.",
  skipped: "Workflow enrollment was skipped.",
  blocked: "Workflow enrollment was blocked.",
  replayed: "Workflow enrollment was already completed and was not repeated.",
};

export function presentSeparatedOperations(input: {
  contactResult?: string | null;
  noteResult?: string | null;
  workflowResult?: string | null;
}): SeparatedOperationResults {
  const contact = input.contactResult ? CONTACT_COPY[input.contactResult] ?? null : null;
  const note = input.noteResult ? NOTE_COPY[input.noteResult] ?? null : null;
  const workflow = input.workflowResult ? WORKFLOW_COPY[input.workflowResult] ?? null : null;
  const lines = [contact, note, workflow].filter((line): line is string => Boolean(line));
  if (lines.length === 0) {
    lines.push("This test response did not include separate contact, note, and workflow outcomes.");
  }
  return { contact, note, workflow, blindRetry: false, lines };
}

export function unsafeBlindRetry(input: {
  contactResult?: string | null;
  noteResult?: string | null;
  workflowResult?: string | null;
}): boolean {
  return [input.contactResult, input.noteResult, input.workflowResult].some(
    (result) => result === "ambiguous" || result === "rejected"
  );
}
