/**
 * What Happened POST body — aligned with API `whatHappenedBodySchema`
 * (apps/api/src/schemas/agent-workspace.schema.ts).
 */

import { dateOnlyInputToIso, parseDateOnlyLocal } from "./date-local.ts";

export const WHAT_HAPPENED_OUTCOMES = [
  "appointment_set",
  "callback_scheduled",
  "not_interested",
  "no_answer",
  "connected_no_result",
  "sale_logged",
  "wrong_number",
  "other",
] as const;

export type WhatHappenedOutcome = (typeof WHAT_HAPPENED_OUTCOMES)[number];

export const WHAT_HAPPENED_OUTCOME_OPTIONS: ReadonlyArray<{ value: WhatHappenedOutcome; label: string }> = [
  { value: "appointment_set", label: "Appointment set" },
  { value: "callback_scheduled", label: "Callback scheduled" },
  { value: "not_interested", label: "Not interested" },
  { value: "no_answer", label: "No answer" },
  { value: "connected_no_result", label: "Connected — no result" },
  { value: "sale_logged", label: "Sale logged" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "other", label: "Other" },
];

/** GHL custom-field strings stored in `metadata` (not validated by outcome Zod enum). */
export const WHAT_HAPPENED_APPT_METADATA_OPTIONS = [
  "",
  "Set",
  "Confirmed",
  "Showed",
  "No-show",
  "Cancelled",
  "Rescheduled",
] as const;

export const WHAT_HAPPENED_POLICY_METADATA_OPTIONS = [
  "",
  "Pending",
  "In underwriting",
  "Approved",
  "Declined",
  "Sale logged",
] as const;

export type ContactIdentityInput = {
  contactIdFromUrl?: string;
  leadUidFromUrl?: string;
};

export function resolveWhatHappenedContactIdentity(input: ContactIdentityInput): {
  contactIdGhl?: string;
  leadUid?: string;
  canSubmit: boolean;
} {
  const contactIdGhl = input.contactIdFromUrl?.trim() || undefined;
  const leadUid = input.leadUidFromUrl?.trim() || undefined;
  return {
    contactIdGhl,
    leadUid,
    canSubmit: Boolean(contactIdGhl || leadUid),
  };
}

export type BuildWhatHappenedBodyInput = ContactIdentityInput & {
  clientAccountId: string;
  locationId?: string;
  outcome: string;
  notes?: string;
  appointmentStatusMetadata?: string;
  policyStatusMetadata?: string;
  followUpDate?: string;
};

export type WhatHappenedRequestBody = {
  clientAccountId: string;
  locationId?: string;
  contactIdGhl?: string;
  leadUid?: string;
  outcome: WhatHappenedOutcome;
  notes?: string;
  metadata?: Record<string, unknown>;
};

export function buildWhatHappenedRequestBody(
  input: BuildWhatHappenedBodyInput
): { ok: true; body: WhatHappenedRequestBody } | { ok: false; error: string } {
  const { contactIdGhl, leadUid, canSubmit } = resolveWhatHappenedContactIdentity({
    contactIdFromUrl: input.contactIdFromUrl,
    leadUidFromUrl: input.leadUidFromUrl,
  });

  if (!canSubmit) {
    return { ok: false, error: "contactIdGhl or leadUid is required" };
  }

  const outcome = input.outcome.trim();
  if (!WHAT_HAPPENED_OUTCOMES.includes(outcome as WhatHappenedOutcome)) {
    return { ok: false, error: "Invalid outcome" };
  }

  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) {
    return { ok: false, error: "clientAccountId is required" };
  }

  const metadata: Record<string, unknown> = {};
  const appt = input.appointmentStatusMetadata?.trim();
  const pol = input.policyStatusMetadata?.trim();
  if (appt) metadata.sa360_appointment_status = appt;
  if (pol) metadata.sa360_policy_status = pol;
  if (input.followUpDate?.trim()) {
    const trimmed = input.followUpDate.trim();
    if (parseDateOnlyLocal(trimmed)) {
      const iso = dateOnlyInputToIso(trimmed);
      if (!iso) return { ok: false, error: "Invalid follow-up date" };
      metadata.nextFollowUpAt = iso;
    } else {
      const d = new Date(trimmed);
      if (Number.isNaN(d.getTime())) {
        return { ok: false, error: "Invalid follow-up date" };
      }
      metadata.nextFollowUpAt = d.toISOString();
    }
  }

  const body: WhatHappenedRequestBody = {
    clientAccountId,
    outcome: outcome as WhatHappenedOutcome,
  };

  const locationId = input.locationId?.trim();
  if (locationId) body.locationId = locationId;
  if (contactIdGhl) body.contactIdGhl = contactIdGhl;
  if (leadUid) body.leadUid = leadUid;

  const notes = input.notes?.trim();
  if (notes) body.notes = notes;
  if (Object.keys(metadata).length > 0) body.metadata = metadata;

  return { ok: true, body };
}

export type WhatHappenedApiErrorJson = {
  error?: string;
  details?: {
    formErrors?: string[];
    fieldErrors?: Record<string, string[]>;
  };
};

export function formatWhatHappenedApiError(
  status: number,
  json: WhatHappenedApiErrorJson,
  rawText?: string
): string {
  const details = json.details;
  const fieldErrors = details?.fieldErrors ?? {};
  const formErrors = details?.formErrors ?? [];

  const contactMsgs = [
    ...(fieldErrors.contactIdGhl ?? []),
    ...(fieldErrors.leadUid ?? []),
    ...formErrors,
  ];
  if (
    contactMsgs.some((m) => /contactIdGhl|leadUid|contact.*required/i.test(m)) ||
    json.error === "contactIdGhl or leadUid is required"
  ) {
    return "Could not save outcome. Missing contact context.";
  }

  const outcomeMsgs = fieldErrors.outcome ?? [];
  if (outcomeMsgs.length > 0 || /invalid.*outcome|enum/i.test(formErrors.join(" "))) {
    return "Could not save outcome. Invalid status value.";
  }

  if (typeof json.error === "string" && json.error.trim() && json.error !== "Invalid body") {
    return json.error.trim();
  }

  if (status === 400) {
    return "Could not save outcome. Check the form and try again.";
  }

  if (rawText?.trim()) {
    return rawText.trim().slice(0, 200);
  }

  return `Could not save outcome (HTTP ${status}).`;
}

export function whatHappenedWorkspaceModeLabel(input: ContactIdentityInput): string {
  const { contactIdGhl, leadUid, canSubmit } = resolveWhatHappenedContactIdentity(input);
  if (!canSubmit) {
    return "Read-only: open from a contact record to save outcomes.";
  }
  const id = contactIdGhl ? `contact ${contactIdGhl}` : `lead ${leadUid}`;
  return `Saving outcomes for ${id}.`;
}
