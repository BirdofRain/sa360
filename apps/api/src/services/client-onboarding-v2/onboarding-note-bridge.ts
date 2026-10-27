/**
 * Connects the sa360_lead_note_v2 formatter to captured-test preview.
 * The planner stays free of a static formatter import. This bridge is the
 * integration wiring. It does not post a note or call GoHighLevel.
 */

import {
  buildOnboardingLeadNote,
  type OnboardingStoredLeadEvent,
} from "../ghl-delivery-adapter/onboarding-lead-note.js";
import {
  auditIntakeQaEvidence,
  type QaEvidence,
} from "../ghl-delivery-adapter/onboarding-qa-evidence.js";
import {
  adaptAgentBLeadNotePlan,
  type BuildOnboardingLeadNote,
  type OnboardingLeadNoteRequest,
} from "./captured-test-delivery.js";

export function storedLeadFromNormalizedPayload(event: {
  id: string;
  receivedAt: string | null;
  normalizedPayloadJson: unknown;
  clientAccountIdResolved?: string | null;
}): OnboardingStoredLeadEvent {
  return {
    ...storedEventFromRequest({
      contract: "sa360_lead_note_v2",
      sourceLeadEventId: event.id,
      testRunId: null,
      receivedAt: event.receivedAt,
      normalizedPayloadJson: event.normalizedPayloadJson,
      noteOverflow: "refuse",
      maxChars: 10_000,
    }),
    clientAccountId: event.clientAccountIdResolved ?? null,
  };
}

export function capturedTestNoteBuilder(): BuildOnboardingLeadNote {
  return (input) => {
    const event = storedEventFromRequest(input);
    const plan = buildOnboardingLeadNote({
      event,
      clientAccountId: event.clientAccountId,
      testRunId: input.testRunId,
      noteOverflow: input.noteOverflow,
      maxChars: input.maxChars,
    });
    const qaEvidence = auditIntakeQaEvidence({
      answers: recordValue(asRecord(input.normalizedPayloadJson)?.answers),
      form: recordValue(asRecord(input.normalizedPayloadJson)?.form),
      fieldData: arrayFieldData(input.normalizedPayloadJson),
      answerFields: event.answerFields ?? null,
      sourceAttributes: event.sourceAttributes ?? null,
      unmappedSourceFields: event.unmappedSourceFields ?? event.unmappedSourceFieldsJson ?? null,
    });
    if (!plan.ok) return { ok: false, code: "note_builder_pending_agent_b", posted: false };
    const adapted = adaptAgentBLeadNotePlan(plan, input.testRunId ?? "");
    if (!adapted.ok) return adapted;
    return { ...adapted, qaEvidence: assertEvidence(qaEvidence) };
  };
}

export function assertEvidence(evidence: QaEvidence): QaEvidence {
  if (evidence.status !== "complete") {
    return { ...evidence, fullQaCompletenessAsserted: false };
  }
  if (evidence.discardedDuplicateCount !== 0) {
    return {
      status: "discarded_duplicates",
      fullQaCompletenessAsserted: false,
      discardedDuplicateCount: evidence.discardedDuplicateCount,
    };
  }
  return evidence;
}

function storedEventFromRequest(input: OnboardingLeadNoteRequest): OnboardingStoredLeadEvent {
  const payload = asRecord(input.normalizedPayloadJson) ?? {};
  const intake = asRecord(asRecord(payload.routing)?.source_intake) ?? {};
  const contact = asRecord(payload.contact) ?? {};
  const answerFields = Array.isArray(intake.answerFields)
    ? (intake.answerFields as OnboardingStoredLeadEvent["answerFields"])
    : Array.isArray(payload.answerFields)
      ? (payload.answerFields as OnboardingStoredLeadEvent["answerFields"])
      : null;
  const sourceAttributes = asRecord(intake.sourceAttributes) ?? asRecord(payload.sourceAttributes);
  const unmapped = Array.isArray(intake.unmappedSourceFieldsJson)
    ? (intake.unmappedSourceFieldsJson as OnboardingStoredLeadEvent["unmappedSourceFields"])
    : Array.isArray(payload.unmappedSourceFields)
      ? (payload.unmappedSourceFields as OnboardingStoredLeadEvent["unmappedSourceFields"])
      : null;
  return {
    sourceLeadEventId: input.sourceLeadEventId,
    generatedAt: input.receivedAt,
    fullName: stringValue(contact.full_name) ?? stringValue(payload.fullName),
    firstName: stringValue(contact.first_name),
    lastName: stringValue(contact.last_name),
    phone: stringValue(contact.phone_e164) ?? stringValue(payload.phone),
    email: stringValue(contact.email) ?? stringValue(payload.email),
    state: stringValue(contact.state) ?? stringValue(payload.state),
    sourceAttributes,
    unmappedSourceFields: unmapped,
    answerFields,
    metaFieldData: arrayFieldData(payload),
    schemaDrift: asRecord(intake.schemaDrift) as OnboardingStoredLeadEvent["schemaDrift"],
  };
}

function arrayFieldData(payload: unknown): OnboardingStoredLeadEvent["metaFieldData"] {
  const record = asRecord(payload);
  const rows = record?.field_data ?? record?.metaFieldData;
  if (!Array.isArray(rows)) return null;
  return rows as OnboardingStoredLeadEvent["metaFieldData"];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return asRecord(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
