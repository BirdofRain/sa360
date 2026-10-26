/**
 * GHL onboarding note contract `sa360_lead_note_v2`.
 *
 * Pure formatter. It does not post a note, enroll a workflow, or read the network.
 * Summary identity and the Form Questions and Answers block stay separate.
 * Primary Reason is not copied into Primary Concern. Age is not calculated from DOB.
 */

import { COMPANY_SHEETS_GENERATION_TIMEZONE, COMPANY_SHEETS_V3_COLUMNS } from "@sa360/shared";

import {
  isReservedSourceRawKey,
  normalizeSourceFieldKey,
  resolveCanonicalAttributeKey,
  type CanonicalSourceAttributeKey,
} from "../source-intake/source-field-alias.registry.js";

export const ONBOARDING_LEAD_NOTE_CONTRACT = "sa360_lead_note_v2" as const;
export const ONBOARDING_LEAD_NOTE_TITLE = "SA360 lead";
export const DEFAULT_GHL_NOTE_BODY_MAX_CHARS = 10_000;

const NOT_SUPPLIED = "not supplied";
const UNANSWERED = "(unanswered)";

/** v3 column source field for a canonical answer. Header text stays on the shared template. */
const CANONICAL_V3_SOURCE_FIELD: Partial<Record<CanonicalSourceAttributeKey, string>> = {
  age: "consumer_age",
  date_of_birth: "date_of_birth",
  military_status: "military_status",
  branch_of_service: "branch_of_service",
  marital_status: "marital_status",
  desired_coverage: "coverage_amount",
  primary_reason: "primary_reason",
  primary_concern: "primary_concern",
  beneficiary: "beneficiary",
  best_time_to_call: "best_time_to_call",
  disability_rating: "disability_rating",
  healthcare_profession: "healthcare_profession",
  rig_type: "rig_type",
  company_or_independent: "company_or_independent",
  homeowner: "homeowner",
  house_type: "house_type",
  sex: "sex",
  phone_verified: "phone_verified",
  email_verified: "email_verified",
  applied_for_other_insurance: "applied_for_other_insurance",
};

const TRACKING_CANONICAL_KEYS = new Set<string>([
  "placement",
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "fbclid",
  "parent_url",
  "trustedform_cert_url",
  "leadid_token",
  "ip_address",
  "user_agent",
]);

const FORBIDDEN_KEY_SEGMENTS = new Set([
  "token",
  "secret",
  "password",
  "authorization",
  "apikey",
  "credential",
  "signature",
]);

const EXPLICIT_FORBIDDEN_NORMALIZED = new Set([
  "xxtrustedformcerturl",
  "trustedformcerturl",
  "fbp",
  "fbc",
]);

export type OnboardingNoteOverflow = "refuse" | "split_continuation";

export type StoredAnswerField = {
  /** LeadCapture key or other stored key, in capture order. */
  key: string;
  /** Meta `field_data.name` when the human label is not the key. */
  name?: string | null;
  value: unknown;
  canonicalKey?: string | null;
};

export type OnboardingSchemaRename = {
  from: string;
  to: string;
  canonical?: string;
};

/**
 * Approved stored lead the formatter is allowed to read.
 * Capture order is `answerFields` when present. Otherwise the formatter walks
 * canonical `sourceAttributes`, then permitted unmapped rows, then Meta
 * `field_data`. It does not walk the rest of the raw payload.
 */
export type OnboardingStoredLeadEvent = {
  sourceLeadEventId: string;
  clientAccountId?: string | null;
  generatedAt?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  state?: string | null;
  leadType?: string | null;
  sourceText?: string | null;
  sourceAttributes?: Record<string, unknown> | null;
  unmappedSourceFields?: Array<{ key: string; value: unknown }> | null;
  unmappedSourceFieldsJson?: Array<{ key: string; value: unknown }> | null;
  metaFieldData?: Array<{ name: string; values?: unknown }> | null;
  answerFields?: StoredAnswerField[] | null;
  schemaDrift?: { possibleRenames?: OnboardingSchemaRename[] } | null;
};

export type ApprovedFormAnswer = {
  index: number;
  baseLabel: string;
  label: string;
  valueText: string;
  unanswered: boolean;
  canonicalKey: string | null;
  renamedFrom: string | null;
  line: string;
};

export type OnboardingLeadNotePart = {
  part: number;
  partCount: number;
  title: string;
  body: string;
  /** True when this part is a character slice of the previous line, not a new line. */
  continuesLine: boolean;
  idempotencyKey: string;
};

export type OnboardingLeadNotePlan = {
  ok: true;
  contractVersion: typeof ONBOARDING_LEAD_NOTE_CONTRACT;
  title: string;
  /** Full note text. Never shortened when the provider cap is exceeded. */
  body: string;
  preview: string;
  answers: ApprovedFormAnswer[];
  keptAnswerCount: number;
  posted: false;
  status: "ready" | "note_too_long";
  error: "note_too_long" | null;
  noteOverflow: OnboardingNoteOverflow;
  maxChars: number;
  parts: OnboardingLeadNotePart[];
};

export type OnboardingLeadNoteFailure = {
  ok: false;
  posted: false;
  error: "client_account_mismatch";
  contractVersion: typeof ONBOARDING_LEAD_NOTE_CONTRACT;
};

export type BuildOnboardingLeadNoteInput = {
  event: OnboardingStoredLeadEvent;
  clientAccountId?: string | null;
  testRunId?: string | null;
  noteOverflow?: OnboardingNoteOverflow | null;
  /** Overrides `SA360_GHL_NOTE_BODY_MAX_CHARS` when set. */
  maxChars?: number;
};

export function resolveGhlNoteBodyMaxChars(raw: string | undefined | null): number {
  if (raw === undefined || raw === null) return DEFAULT_GHL_NOTE_BODY_MAX_CHARS;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_GHL_NOTE_BODY_MAX_CHARS;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_GHL_NOTE_BODY_MAX_CHARS;
  return parsed;
}

export function isForbiddenOnboardingAnswerKey(key: string): boolean {
  const normalized = normalizeSourceFieldKey(key);
  if (!normalized) return true;
  if (isReservedSourceRawKey(key)) return true;
  if (EXPLICIT_FORBIDDEN_NORMALIZED.has(normalized)) return true;
  if (normalized.startsWith("utm_")) return true;
  if (TRACKING_CANONICAL_KEYS.has(normalized)) return true;
  if (normalized.includes("api_key") || normalized.includes("apikey")) return true;
  const segments = normalized.split("_").filter(Boolean);
  if (segments.some((segment) => FORBIDDEN_KEY_SEGMENTS.has(segment))) return true;
  if ([...FORBIDDEN_KEY_SEGMENTS].some((segment) => normalized.includes(segment))) return true;
  return false;
}

/** Combined Age/DOB labels are ambiguous. They are not an Age answer or a DOB answer. */
export function isCombinedAgeDobLabel(label: string): boolean {
  const collapsed = normalizeSourceFieldKey(label).replace(/_+/g, "");
  return collapsed === "agedob";
}

export function listApprovedFormAnswers(event: OnboardingStoredLeadEvent): ApprovedFormAnswer[] {
  const renames = event.schemaDrift?.possibleRenames ?? [];
  const kept: Array<{
    baseLabel: string;
    valueText: string;
    unanswered: boolean;
    canonicalKey: string | null;
    renamedFrom: string | null;
  }> = [];

  for (const field of captureFields(event)) {
    const key = field.key?.trim() ?? "";
    const explicitName = field.name?.trim() ?? "";
    if (!key && !explicitName) continue;
    if ([key, explicitName].some((candidate) => candidate && isForbiddenOnboardingAnswerKey(candidate))) {
      continue;
    }
    const canonical =
      field.canonicalKey ??
      (key ? resolveCanonicalAttributeKey(key) : null) ??
      (explicitName ? resolveCanonicalAttributeKey(explicitName) : null);
    if (canonical && isForbiddenOnboardingAnswerKey(canonical)) continue;

    const baseLabel = resolveBaseLabel(field, canonical);
    if (!baseLabel || isCombinedAgeDobLabel(baseLabel) || isForbiddenOnboardingAnswerKey(baseLabel)) {
      continue;
    }
    const formatted = formatAnswerValue(field.value);
    if (formatted.kind === "skip") continue;
    kept.push({
      baseLabel,
      valueText: formatted.kind === "unanswered" ? UNANSWERED : formatted.text,
      unanswered: formatted.kind === "unanswered",
      canonicalKey: canonical,
      renamedFrom: renameEvidence(baseLabel, key || explicitName, canonical, renames),
    });
  }

  const seen = new Map<string, number>();
  return kept.map((answer, index) => {
    const occurrence = (seen.get(answer.baseLabel) ?? 0) + 1;
    seen.set(answer.baseLabel, occurrence);
    const label = displayLabel(answer.baseLabel, occurrence, answer.renamedFrom);
    const line = `${index + 1}. ${label}: ${answer.valueText}`;
    return {
      index: index + 1,
      baseLabel: answer.baseLabel,
      label,
      valueText: answer.valueText,
      unanswered: answer.unanswered,
      canonicalKey: answer.canonicalKey,
      renamedFrom: answer.renamedFrom,
      line,
    };
  });
}

export function buildOnboardingLeadNote(
  input: BuildOnboardingLeadNoteInput
): OnboardingLeadNotePlan | OnboardingLeadNoteFailure {
  const event = input.event;
  const clientAccountId = input.clientAccountId?.trim() || null;
  const eventClient = event.clientAccountId?.trim() || null;
  if (clientAccountId && eventClient && clientAccountId !== eventClient) {
    return {
      ok: false,
      posted: false,
      error: "client_account_mismatch",
      contractVersion: ONBOARDING_LEAD_NOTE_CONTRACT,
    };
  }

  const answers = listApprovedFormAnswers(event);
  const testRunId = input.testRunId?.trim() || null;
  const body = renderBody(event, answers, testRunId);
  const noteOverflow = input.noteOverflow === "split_continuation" ? "split_continuation" : "refuse";
  const maxChars =
    input.maxChars ??
    resolveGhlNoteBodyMaxChars(process.env.SA360_GHL_NOTE_BODY_MAX_CHARS);
  const slices = splitNoteBody(body, maxChars);
  const overflowed = body.length > maxChars;
  const postParts = !overflowed || noteOverflow === "split_continuation";
  const partCount = postParts ? slices.length : 0;
  const sourceLeadEventId = event.sourceLeadEventId.trim();
  const parts: OnboardingLeadNotePart[] = postParts
    ? slices.map((slice) => ({
        part: 0,
        partCount,
        title: ONBOARDING_LEAD_NOTE_TITLE,
        body: slice.body,
        continuesLine: slice.continuesLine,
        idempotencyKey: "",
      }))
    : [];

  parts.forEach((part, index) => {
    part.part = index + 1;
    part.partCount = parts.length;
    part.title =
      parts.length > 1
        ? `${ONBOARDING_LEAD_NOTE_TITLE} (${part.part}/${parts.length})`
        : ONBOARDING_LEAD_NOTE_TITLE;
    part.idempotencyKey = onboardingNoteIdempotencyKey({
      testRunId,
      clientAccountId,
      sourceLeadEventId,
      part: part.part,
      partCount: parts.length,
    });
  });

  const refused = overflowed && noteOverflow === "refuse";
  return {
    ok: true,
    contractVersion: ONBOARDING_LEAD_NOTE_CONTRACT,
    title: ONBOARDING_LEAD_NOTE_TITLE,
    body,
    preview: body,
    answers,
    keptAnswerCount: answers.length,
    posted: false,
    status: refused ? "note_too_long" : "ready",
    error: refused ? "note_too_long" : null,
    noteOverflow,
    maxChars,
    parts,
  };
}

export function onboardingNoteIdempotencyKey(input: {
  testRunId?: string | null;
  clientAccountId?: string | null;
  sourceLeadEventId: string;
  part: number;
  partCount: number;
}): string {
  if (input.testRunId) {
    return `onboarding-test:${input.testRunId}:ghl-note:${input.part}`;
  }
  const client = input.clientAccountId ?? "";
  if (input.part <= 1) return `ghl-note:${client}:${input.sourceLeadEventId}`;
  return `ghl-note:${client}:${input.sourceLeadEventId}:${input.part}`;
}

/** Join split parts back to the original body. Character slices do not gain a newline. */
export function reconstructOnboardingNoteBody(parts: Array<Pick<OnboardingLeadNotePart, "body" | "continuesLine">>): string {
  let text = "";
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;
    if (index > 0 && !part.continuesLine) text += "\n";
    text += part.body;
  }
  return text;
}

function captureFields(event: OnboardingStoredLeadEvent): StoredAnswerField[] {
  if (event.answerFields) return event.answerFields;
  const fields: StoredAnswerField[] = [];
  const attributes = event.sourceAttributes;
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    for (const [key, value] of Object.entries(attributes)) {
      fields.push({ key, value, canonicalKey: key });
    }
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

function resolveBaseLabel(field: StoredAnswerField, canonical: string | null): string {
  const explicit = field.name?.trim() ?? "";
  if (explicit) return explicit;
  const key = field.key.trim();
  if (isCapturedQuestionText(key)) return key;
  const header = canonical ? v3HeaderForCanonical(canonical) : null;
  return header ?? key;
}

function isCapturedQuestionText(key: string): boolean {
  return /\s/.test(key) || /[A-Z]/.test(key);
}

function v3HeaderForCanonical(canonical: string): string | null {
  const sourceField = CANONICAL_V3_SOURCE_FIELD[canonical as CanonicalSourceAttributeKey];
  if (!sourceField) return null;
  const column = COMPANY_SHEETS_V3_COLUMNS.find((entry) => entry.sourceField === sourceField);
  return column?.header ?? null;
}

function renameEvidence(
  baseLabel: string,
  key: string,
  canonical: string | null,
  renames: OnboardingSchemaRename[]
): string | null {
  const labelNorm = normalizeSourceFieldKey(baseLabel);
  const keyNorm = normalizeSourceFieldKey(key);
  for (const rename of renames) {
    const toNorm = normalizeSourceFieldKey(rename.to ?? "");
    if (!toNorm || (toNorm !== labelNorm && toNorm !== keyNorm)) continue;
    if (canonical && rename.canonical && rename.canonical !== canonical) continue;
    const from = rename.from?.trim() ?? "";
    if (!from) continue;
    if (normalizeSourceFieldKey(from) === labelNorm) continue;
    return from;
  }
  return null;
}

function displayLabel(baseLabel: string, occurrence: number, renamedFrom: string | null): string {
  const numbered = occurrence > 1 ? `${baseLabel} (${occurrence})` : baseLabel;
  return renamedFrom ? `${numbered} (was: ${renamedFrom})` : numbered;
}

type FormattedValue =
  | { kind: "text"; text: string }
  | { kind: "unanswered" }
  | { kind: "skip" };

function formatAnswerValue(value: unknown): FormattedValue {
  if (value === null || value === undefined) return { kind: "unanswered" };
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: "unanswered" };
    const parts: string[] = [];
    let sawRaw = false;
    for (const item of value) {
      if (item !== null && typeof item === "object") {
        sawRaw = true;
        continue;
      }
      const text = scalarAnswerText(item);
      if (text) parts.push(text);
    }
    if (parts.length === 0) return sawRaw ? { kind: "skip" } : { kind: "unanswered" };
    return { kind: "text", text: parts.join("; ") };
  }
  if (typeof value === "object") return { kind: "skip" };
  const text = scalarAnswerText(value);
  if (!text) return { kind: "unanswered" };
  return { kind: "text", text };
}

function scalarAnswerText(value: unknown): string {
  if (typeof value === "string") return value.replace(/\n/g, " ").trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function renderBody(
  event: OnboardingStoredLeadEvent,
  answers: ApprovedFormAnswer[],
  testRunId: string | null
): string {
  const attributes = event.sourceAttributes ?? null;
  const summary = [
    `Lead: ${supplied(leadName(event))}`,
    `Phone: ${supplied(event.phone)}`,
    `Email: ${supplied(event.email)}`,
    `State: ${supplied(event.state)}`,
    `Date: ${summaryGenerationDate(event.generatedAt)}`,
    `Lead type: ${supplied(event.leadType)}`,
    `Age: ${summaryAge(attributes)}`,
    `DOB: ${summaryDob(attributes)}`,
    `Primary reason: ${summaryAttribute(attributes, "primary_reason")}`,
    `Primary concern: ${summaryAttribute(attributes, "primary_concern")}`,
    `Source: ${supplied(event.sourceText)}`,
    `SA360 event: ${event.sourceLeadEventId.trim()}`,
  ];
  if (testRunId) summary.push(`SA360 test run: ${testRunId}`);
  const questions = ["Form Questions and Answers", ...answers.map((answer) => answer.line)];
  return `${summary.join("\n")}\n\n${questions.join("\n")}`;
}

function leadName(event: OnboardingStoredLeadEvent): string {
  const full = event.fullName?.trim() ?? "";
  if (full) return full;
  return [event.firstName?.trim() ?? "", event.lastName?.trim() ?? ""].filter(Boolean).join(" ");
}

function supplied(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : NOT_SUPPLIED;
}

function summaryAttribute(
  attributes: Record<string, unknown> | null,
  key: "primary_reason" | "primary_concern"
): string {
  if (!attributes || !Object.prototype.hasOwnProperty.call(attributes, key)) return NOT_SUPPLIED;
  const text = scalarAnswerText(attributes[key]);
  return text || NOT_SUPPLIED;
}

function summaryAge(attributes: Record<string, unknown> | null): string {
  if (!attributes || !Object.prototype.hasOwnProperty.call(attributes, "age")) return NOT_SUPPLIED;
  const value = attributes.age;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return NOT_SUPPLIED;
}

function summaryDob(attributes: Record<string, unknown> | null): string {
  if (!attributes || !Object.prototype.hasOwnProperty.call(attributes, "date_of_birth")) {
    return NOT_SUPPLIED;
  }
  return formatSummaryDob(attributes.date_of_birth);
}

function formatSummaryDob(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return NOT_SUPPLIED;
  const raw = value.trim();
  if (!raw) return NOT_SUPPLIED;
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (isoDay) return `${isoDay[2]}/${isoDay[3]}/${isoDay[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return formatNewYorkCalendarDate(parsed);
  }
  return raw;
}

function summaryGenerationDate(generatedAt: string | null | undefined): string {
  const raw = generatedAt?.trim() ?? "";
  if (!raw) return NOT_SUPPLIED;
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (isoDay) return `${isoDay[2]}/${isoDay[3]}/${isoDay[1]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return NOT_SUPPLIED;
  return formatNewYorkCalendarDate(parsed);
}

function formatNewYorkCalendarDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: COMPANY_SHEETS_GENERATION_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const year = parts.find((part) => part.type === "year")?.value;
  if (!month || !day || !year) return NOT_SUPPLIED;
  return `${month}/${day}/${year}`;
}

type NoteSlice = { body: string; continuesLine: boolean };

export function splitNoteBody(body: string, maxChars: number): NoteSlice[] {
  const cap = maxChars;
  if (body.length <= cap) return [{ body, continuesLine: false }];
  const lines = body.split("\n");
  const slices: NoteSlice[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.length === 0) return;
    slices.push({ body: current, continuesLine: false });
    current = "";
  };

  for (const line of lines) {
    if (line.length > cap) {
      pushCurrent();
      for (let offset = 0; offset < line.length; offset += cap) {
        slices.push({
          body: line.slice(offset, offset + cap),
          continuesLine: offset > 0,
        });
      }
      continue;
    }
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length <= cap) {
      current = candidate;
    } else {
      pushCurrent();
      current = line;
    }
  }
  pushCurrent();
  return slices;
}
