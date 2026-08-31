/**
 * PPL buyer-ready eligibility — delivery-quality rules applied before reservation.
 *
 * A candidate must not count toward requested/reserved quantity unless it
 * satisfies the current beta delivery-quality policy. These rules match the
 * cleanup Alex currently performs after export; they do not invent extra
 * quality requirements (no age-range, zip, or optional sales-context checks).
 *
 * Name field precedence matches buyer CSV extractors. Consumer age reuses
 * readBuyerCsvV3ZipAndAge (lead_details.consumer_age, then flat consumer_age).
 */

import { readBuyerCsvV3ZipAndAge } from "./buyer-lead-fields.js";

export type PplBuyerReadyRejectionReason =
  | "missing_consumer_age"
  | "first_name_too_short"
  | "last_name_too_short"
  | "first_name_multipart"
  | "last_name_multipart";

export type PplBuyerReadyEligibility =
  | {
      ok: true;
      firstName: string;
      lastName: string;
      consumerAge: string;
    }
  | { ok: false; reasons: PplBuyerReadyRejectionReason[] };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readTrimmedString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/** Same precedence as extractBuyerCsvFields first_name / last_name. */
export function readPplBuyerReadyNames(normalizedPayloadJson: unknown): {
  firstName: string;
  lastName: string;
} {
  const payload = asRecord(normalizedPayloadJson) ?? {};
  const contact = asRecord(payload.contact) ?? {};
  return {
    firstName: readTrimmedString(
      contact.first_name,
      contact.firstName,
      payload.first_name,
      payload.firstName
    ),
    lastName: readTrimmedString(
      contact.last_name,
      contact.lastName,
      payload.last_name,
      payload.lastName
    ),
  };
}

function nameTokenIssues(
  value: string,
  field: "first_name" | "last_name"
): PplBuyerReadyRejectionReason[] {
  if (value.length <= 1) {
    return [field === "first_name" ? "first_name_too_short" : "last_name_too_short"];
  }
  if (/\s/.test(value)) {
    return [field === "first_name" ? "first_name_multipart" : "last_name_multipart"];
  }
  return [];
}

export function evaluatePplBuyerReadyEligibility(
  normalizedPayloadJson: unknown
): PplBuyerReadyEligibility {
  const consumerAge = readBuyerCsvV3ZipAndAge(normalizedPayloadJson).age;
  const { firstName, lastName } = readPplBuyerReadyNames(normalizedPayloadJson);
  const reasons: PplBuyerReadyRejectionReason[] = [];

  if (!consumerAge) reasons.push("missing_consumer_age");
  reasons.push(...nameTokenIssues(firstName, "first_name"));
  reasons.push(...nameTokenIssues(lastName, "last_name"));

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, firstName, lastName, consumerAge };
}

export function isPplBuyerReadyLead(normalizedPayloadJson: unknown): boolean {
  return evaluatePplBuyerReadyEligibility(normalizedPayloadJson).ok;
}
