/**
 * Customer-facing GHL contact note for native ongoing-association delivery.
 *
 * Reads the stored lead the intake summary already has. It does not rewrite
 * source attributes, route the lead, stamp GHL fields, or post the note.
 * Identity lines come first. Answered insurance questions follow, using the
 * canonical attribute registry and the campaign sheet headers as labels.
 * Unmapped questions that do not resolve through that registry are omitted.
 * Age is not calculated from date of birth, and primary reason is not copied
 * into primary concern.
 */

import { COMPANY_SHEETS_V3_COLUMNS } from "@sa360/shared";

import { formatCampaignDobSheet, parseCampaignDateOfBirth } from "../consumer-age/campaign-dob-age.js";
import {
  CANONICAL_SOURCE_ATTRIBUTE_KEYS,
  INCOMING_IDENTITY_FIELD_ALIASES,
  normalizeSourceFieldKey,
  resolveCanonicalAttributeKey,
  scopedAliasForKey,
  type CanonicalSourceAttributeKey,
  type ScopedIncomingFieldBinding,
} from "../source-intake/source-field-alias.registry.js";
import {
  resolveGhlNoteBodyMaxChars,
  splitNoteBody,
  type OnboardingNoteOverflow,
  type OnboardingStoredLeadEvent,
  type StoredAnswerField,
} from "./onboarding-lead-note.js";

export const GHL_AGENT_LEAD_NOTE_HEADING = "KEY INFO:";

const CANONICAL_KEYS = new Set<string>(CANONICAL_SOURCE_ATTRIBUTE_KEYS);

/** Canonical keys that are operational metadata, not an answer an agent should read. */
const SUPPRESSED_CANONICAL = new Set<string>([
  "placement",
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "fbclid",
  "parent_url",
  "trustedform_cert_url",
  "leadid_token",
  "phone_verified",
  "email_verified",
  "ip_address",
  "user_agent",
]);

/**
 * Sheet column that already names the human label. `desired_coverage` is stored
 * under the coverage_amount column. `age` is stored under consumer_age.
 */
const QUALIFICATION_FIELDS: ReadonlyArray<{
  canonical: CanonicalSourceAttributeKey;
  sourceField: string;
}> = [
  { canonical: "marital_status", sourceField: "marital_status" },
  { canonical: "desired_coverage", sourceField: "coverage_amount" },
  { canonical: "beneficiary", sourceField: "beneficiary" },
  { canonical: "best_time_to_call", sourceField: "best_time_to_call" },
  { canonical: "primary_reason", sourceField: "primary_reason" },
  { canonical: "military_status", sourceField: "military_status" },
  { canonical: "branch_of_service", sourceField: "branch_of_service" },
  { canonical: "primary_concern", sourceField: "primary_concern" },
  { canonical: "disability_rating", sourceField: "disability_rating" },
  { canonical: "healthcare_profession", sourceField: "healthcare_profession" },
  { canonical: "rig_type", sourceField: "rig_type" },
  { canonical: "company_or_independent", sourceField: "company_or_independent" },
  { canonical: "homeowner", sourceField: "homeowner" },
  { canonical: "house_type", sourceField: "house_type" },
  { canonical: "applied_for_other_insurance", sourceField: "applied_for_other_insurance" },
  { canonical: "age", sourceField: "consumer_age" },
];

const QUALIFICATION_INDEX = new Map(QUALIFICATION_FIELDS.map((field) => [field.canonical, field]));

/** No campaign column owns this canonical. The label stays explicit and reviewed. */
const FALLBACK_LABEL: Partial<Record<CanonicalSourceAttributeKey, string>> = {
  applied_for_other_insurance: "Applied for Other Insurance",
};

const HEADER_BY_SOURCE = new Map(COMPANY_SHEETS_V3_COLUMNS.map((column) => [column.sourceField, column.header]));

type IdentitySlot = "lead" | "first" | "last" | "phone" | "email" | "state";

const IDENTITY_ALIAS_SLOT = new Map<string, IdentitySlot>();
for (const [slot, aliases] of Object.entries(INCOMING_IDENTITY_FIELD_ALIASES)) {
  const mapped: IdentitySlot | null =
    slot === "full_name"
      ? "lead"
      : slot === "first_name"
        ? "first"
        : slot === "last_name"
          ? "last"
          : slot === "phone"
            ? "phone"
            : slot === "email"
              ? "email"
              : slot === "state"
                ? "state"
                : null;
  if (!mapped) continue;
  for (const alias of aliases) {
    const normalized = normalizeSourceFieldKey(alias);
    if (normalized) IDENTITY_ALIAS_SLOT.set(normalized, mapped);
  }
}

const PLACEHOLDERS = new Set(["not supplied", "(unanswered)", "undefined", "null"]);

export type AgentGhlLeadNoteInput = {
  event: OnboardingStoredLeadEvent;
  /**
   * Reviewed per-route aliases. Ambiguous keys such as `date` stay unmapped
   * here, matching `resolveCanonicalAttributeKey`.
   */
  routeAliasOverrides?: Record<string, readonly string[]>;
  /**
   * A confirmed LeadCapture binding. This is the only place a bare `date`
   * answer becomes date of birth. Unrelated dates are not inferred.
   */
  scopedBinding?: ScopedIncomingFieldBinding | null;
  noteOverflow?: OnboardingNoteOverflow | null;
  maxChars?: number;
};

export type AgentGhlLeadNotePart = {
  body: string;
  continuesLine: boolean;
};

export type AgentGhlLeadNote = {
  body: string;
  status: "ready" | "note_too_long";
  maxChars: number;
  parts: AgentGhlLeadNotePart[];
};

export function formatAgentGhlLeadNote(input: AgentGhlLeadNoteInput): string {
  const event = input.event;
  const overrides = input.routeAliasOverrides;
  let lead = present(event.fullName);
  let first = present(event.firstName);
  let last = present(event.lastName);
  if (!lead) lead = joinName(first, last);
  let phone = present(event.phone);
  let email = present(event.email);
  let state = present(event.state);
  let sex = "";
  const dobCandidates: string[] = [];
  const qualifications = new Map<CanonicalSourceAttributeKey, string>();

  const consider = (key: string, explicitCanonical: string | null | undefined, value: unknown) => {
    if (isOperationalRawKey(key)) return;
    const canonical = noteCanonical(key, explicitCanonical, overrides, input.scopedBinding);
    const scalars = scalarStrings(value);
    if (scalars.length === 0) return;

    if (canonical === "date_of_birth") {
      dobCandidates.push(...scalars);
      return;
    }
    if (canonical === "sex") {
      if (!sex) sex = present(scalars[0]) ?? "";
      return;
    }
    if (canonical && QUALIFICATION_INDEX.has(canonical)) {
      for (const scalar of scalars) {
        const next = mergeDistinct(qualifications.get(canonical), scalar);
        if (next) qualifications.set(canonical, next);
      }
      return;
    }

    const slot = IDENTITY_ALIAS_SLOT.get(normalizeSourceFieldKey(key));
    if (!slot) return;
    const incoming = scalars[0] ?? "";
    if (slot === "lead" && !lead) lead = present(incoming);
    else if (slot === "first" && !first) first = present(incoming);
    else if (slot === "last" && !last) last = present(incoming);
    else if (slot === "phone" && !phone) phone = present(incoming);
    else if (slot === "email" && !email) email = present(incoming);
    else if (slot === "state" && !state) state = present(incoming);
  };

  const attributes = event.sourceAttributes;
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    for (const [key, value] of Object.entries(attributes)) {
      consider(key, CANONICAL_KEYS.has(key) ? key : null, value);
    }
  }
  for (const field of listedFields(event)) consider(field.key, field.canonicalKey, field.value);

  if (!lead) lead = joinName(first, last);
  const dob = chooseDob(dobCandidates);
  const dobLabel = HEADER_BY_SOURCE.get("date_of_birth") ?? "DOB";
  const sexLabel = HEADER_BY_SOURCE.get("sex") ?? "Sex";

  const lines = [GHL_AGENT_LEAD_NOTE_HEADING];
  pushLine(lines, "Lead", lead);
  pushLine(lines, "Phone", phone);
  pushLine(lines, "Email", email);
  pushLine(lines, "State", state);
  pushLine(lines, dobLabel, dob);
  pushLine(lines, sexLabel, sex || null);
  for (const field of QUALIFICATION_FIELDS) {
    const value = qualifications.get(field.canonical);
    if (!value) continue;
    const label = HEADER_BY_SOURCE.get(field.sourceField) ?? FALLBACK_LABEL[field.canonical] ?? null;
    if (!label) continue;
    pushLine(lines, label, value);
  }
  return lines.join("\n");
}

export function buildAgentGhlLeadNote(input: AgentGhlLeadNoteInput): AgentGhlLeadNote {
  const body = formatAgentGhlLeadNote(input);
  const maxChars = input.maxChars ?? resolveGhlNoteBodyMaxChars(process.env.SA360_GHL_NOTE_BODY_MAX_CHARS);
  const overflow = input.noteOverflow === "split_continuation" ? "split_continuation" : "refuse";
  if (body.length > maxChars && overflow === "refuse") {
    return { body, status: "note_too_long", maxChars, parts: [] };
  }
  return {
    body,
    status: "ready",
    maxChars,
    parts: splitNoteBody(body, maxChars),
  };
}

function listedFields(event: OnboardingStoredLeadEvent): StoredAnswerField[] {
  const fields: StoredAnswerField[] = [];
  for (const field of event.answerFields ?? []) {
    if (field && typeof field.key === "string") fields.push(field);
  }
  const unmapped = event.unmappedSourceFields ?? event.unmappedSourceFieldsJson ?? [];
  for (const row of unmapped) {
    if (!row || typeof row.key !== "string") continue;
    fields.push({ key: row.key, value: row.value });
  }
  for (const row of event.metaFieldData ?? []) {
    if (!row || typeof row.name !== "string") continue;
    fields.push({ key: row.name, name: row.name, value: row.values });
  }
  return fields;
}

function noteCanonical(
  key: string,
  explicit: string | null | undefined,
  overrides: Record<string, readonly string[]> | undefined,
  scopedBinding: ScopedIncomingFieldBinding | null | undefined
): CanonicalSourceAttributeKey | null {
  const explicitKey = explicit?.trim() ?? "";
  if (explicitKey && CANONICAL_KEYS.has(explicitKey) && !SUPPRESSED_CANONICAL.has(explicitKey)) {
    return explicitKey as CanonicalSourceAttributeKey;
  }
  const resolved = resolveCanonicalAttributeKey(key, overrides) ?? scopedAliasForKey(scopedBinding ?? null, key);
  if (resolved && !SUPPRESSED_CANONICAL.has(resolved)) return resolved;
  return null;
}

function isOperationalRawKey(key: string): boolean {
  const normalized = normalizeSourceFieldKey(key);
  if (!normalized) return true;
  if (normalized.startsWith("anura")) return true;
  if (normalized.startsWith("utm_")) return true;
  if (normalized.startsWith("sa360_")) return true;
  if (
    normalized === "ttp" ||
    normalized === "ttclid" ||
    normalized === "fbp" ||
    normalized === "fbc" ||
    normalized === "fbclid" ||
    normalized === "gclid"
  ) {
    return true;
  }
  if (normalized.includes("session_recording")) return true;
  if (normalized === "resume_url" || normalized.endsWith("_resume_url")) return true;
  if (normalized === "ip_address" || normalized === "user_agent") return true;
  if (normalized.includes("trustedform") || normalized.includes("trusted_form")) return true;
  if (
    normalized.includes("idempotency") ||
    normalized.includes("delivery_id") ||
    normalized.includes("source_lead_event") ||
    normalized === "client_account_id"
  ) {
    return true;
  }
  if (
    normalized === "phone_verified" ||
    normalized === "email_verified" ||
    normalized === "email_verification_status" ||
    normalized === "is_verified_lead" ||
    normalized === "is_partial_lead" ||
    normalized === "verfi_proof_url" ||
    normalized.includes("lead_score") ||
    normalized.includes("leadscore")
  ) {
    return true;
  }
  return false;
}

function pushLine(lines: string[], label: string, value: string | null): void {
  if (!value) return;
  lines.push(`${label}: ${value}`);
}

function joinName(first: string | null, last: string | null): string | null {
  const joined = [first, last].filter((part): part is string => Boolean(part)).join(" ");
  return joined || null;
}

function chooseDob(candidates: string[]): string | null {
  for (const raw of candidates) {
    const iso = parseCampaignDateOfBirth(raw);
    if (!iso) continue;
    const formatted = formatCampaignDobSheet(iso);
    if (formatted) return formatted;
  }
  for (const raw of candidates) {
    const text = present(raw);
    if (text) return text;
  }
  return null;
}

function mergeDistinct(existing: string | undefined, incoming: string): string {
  const presented = present(incoming);
  if (!presented) return existing ?? "";
  if (!existing) return presented;
  if (existing.split("; ").includes(presented)) return existing;
  return `${existing}; ${presented}`;
}

function present(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const flat = flatten(value);
  if (!flat || isPlaceholder(flat)) return null;
  if (!/[<>]/.test(flat)) return flat;
  return flat.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function flatten(value: string): string {
  return value.replace(/\r\n|\r|\n/g, " ").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDERS.has(value.toLowerCase());
}

function scalarStrings(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => scalarStrings(item));
  if (typeof value === "string") {
    const flat = flatten(value);
    return flat && !isPlaceholder(flat) ? [flat] : [];
  }
  if (typeof value === "number" && Number.isFinite(value)) return [String(value)];
  if (typeof value === "boolean") return [value ? "true" : "false"];
  return [];
}
