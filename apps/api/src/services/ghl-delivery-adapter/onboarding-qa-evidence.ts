/**
 * Read-only intake evidence audit for sa360_lead_note_v2.
 *
 * The formatter renders stored answers. This audit decides whether those
 * stored answers cover the raw capture. It does not re-run extraction, rewrite
 * source attributes, or reconstruct a discarded answer.
 */

import {
  isForbiddenOnboardingAnswerKey,
  type OnboardingStoredLeadEvent,
  type StoredAnswerField,
} from "./onboarding-lead-note.js";
import { normalizeSourceFieldKey, resolveCanonicalAttributeKey } from "../source-intake/source-field-alias.registry.js";

export type QaEvidenceStatus = "complete" | "discarded_duplicates" | "not_recoverable";

export type QaEvidence = {
  status: QaEvidenceStatus;
  fullQaCompletenessAsserted: boolean;
  discardedDuplicateCount: number;
};

export type IntakeEvidenceSource = {
  answers?: Record<string, unknown> | null;
  form?: Record<string, unknown> | null;
  fieldData?: Array<{ name?: string | null; values?: unknown }> | null;
  answerFields?: StoredAnswerField[] | null;
  sourceAttributes?: Record<string, unknown> | null;
  unmappedSourceFields?: Array<{ key?: string | null; value?: unknown }> | null;
};

const NOT_RECOVERABLE: QaEvidence = {
  status: "not_recoverable",
  fullQaCompletenessAsserted: false,
  discardedDuplicateCount: 0,
};

export function auditIntakeQaEvidence(source: IntakeEvidenceSource): QaEvidence {
  const raw = rawEntries(source);
  if (raw.length === 0) return NOT_RECOVERABLE;

  const stored = storedCounts(source);
  const consumedNormalized = new Set<string>();
  const seenCanonical = new Set<string>();
  let discarded = 0;

  for (const entry of raw) {
    if (isForbiddenOnboardingAnswerKey(entry.key) || (entry.name != null && isForbiddenOnboardingAnswerKey(entry.name))) {
      continue;
    }
    const normalized = normalizeSourceFieldKey(entry.key);
    const canonical =
      resolveCanonicalAttributeKey(entry.key) ??
      (entry.name ? resolveCanonicalAttributeKey(entry.name) : null);
    const laterDuplicate =
      (normalized.length > 0 && consumedNormalized.has(normalized)) ||
      (canonical != null && seenCanonical.has(canonical));
    if (laterDuplicate) {
      if (!consumeStored(stored, [entry.name, entry.key, canonical])) discarded += 1;
      continue;
    }
    if (normalized.length > 0) consumedNormalized.add(normalized);
    if (canonical) seenCanonical.add(canonical);
    consumeStored(stored, [entry.name, entry.key, canonical]);
  }

  if (discarded > 0) {
    return {
      status: "discarded_duplicates",
      fullQaCompletenessAsserted: false,
      discardedDuplicateCount: discarded,
    };
  }
  return {
    status: "complete",
    fullQaCompletenessAsserted: true,
    discardedDuplicateCount: 0,
  };
}

export function intakeEvidenceFromStoredEvent(event: OnboardingStoredLeadEvent & Record<string, unknown>): IntakeEvidenceSource {
  const answers = recordValue(event.answers);
  const form = recordValue(event.form);
  const fieldData = Array.isArray(event.field_data)
    ? (event.field_data as Array<{ name?: string | null; values?: unknown }>)
    : event.metaFieldData ?? null;
  return {
    answers,
    form,
    fieldData,
    answerFields: event.answerFields ?? null,
    sourceAttributes: event.sourceAttributes ?? null,
    unmappedSourceFields: event.unmappedSourceFields ?? event.unmappedSourceFieldsJson ?? null,
  };
}

function rawEntries(source: IntakeEvidenceSource): Array<{ key: string; name: string | null }> {
  const entries: Array<{ key: string; name: string | null }> = [];
  pushObject(entries, source.answers);
  pushObject(entries, source.form);
  for (const row of source.fieldData ?? []) {
    const name = row?.name?.trim() ?? "";
    if (!name) continue;
    entries.push({ key: name, name });
  }
  return entries;
}

function pushObject(entries: Array<{ key: string; name: string | null }>, value: Record<string, unknown> | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (!key.trim()) continue;
    entries.push({ key, name: null });
  }
}

function storedCounts(source: IntakeEvidenceSource): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (label: string | null | undefined) => {
    const normalized = normalizeSourceFieldKey(label ?? "");
    if (!normalized || isForbiddenOnboardingAnswerKey(normalized)) return;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  };
  if (source.answerFields) {
    for (const field of source.answerFields) add(field.name?.trim() || field.key);
    return counts;
  }
  for (const key of Object.keys(source.sourceAttributes ?? {})) add(key);
  for (const row of source.unmappedSourceFields ?? []) add(row?.key ?? "");
  return counts;
}

function consumeStored(counts: Map<string, number>, labels: Array<string | null | undefined>): boolean {
  for (const label of labels) {
    const normalized = normalizeSourceFieldKey(label ?? "");
    const left = counts.get(normalized) ?? 0;
    if (!normalized || left < 1) continue;
    counts.set(normalized, left - 1);
    return true;
  }
  return false;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
