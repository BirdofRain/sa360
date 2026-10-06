import type { Prisma } from "@prisma/client";

import { tryNormalizeToVerifiedE164 } from "../phone-e164.service.js";
import { readFacebookId } from "./facebook-form-association.js";
import type { FacebookFormAssociationResolution } from "./facebook-form-association.service.js";
import {
  FACEBOOK_LEAD_PROVIDER,
  FACEBOOK_LEAD_SOURCE_SYSTEM,
  buildFacebookLeadUid,
  type FacebookLeadFields,
} from "./facebook-lead-normalizer.js";
import type { ZapierFacebookCaptureFields } from "./zapier-facebook-capture-payload.js";
import { withIntakeConsumerAge } from "../consumer-age/consumer-age-intake.js";

/**
 * Shared capture-only record builders for Facebook Lead Ads.
 *
 * Both intake methods (Zapier-first and Meta-first) write the same
 * `sa360.facebook_capture.v1` normalized payload and the same enrichment
 * shape so Admin C.O.C., association reevaluation, and client rekey treat them
 * identically. Only the provenance fields differ; nothing here fabricates one
 * provenance for the other.
 */

export const META_LEAD_ADS_INTAKE_METHOD = "meta_lead_ads";

export type FacebookCaptureIntakeMethod = "zapier_facebook" | typeof META_LEAD_ADS_INTAKE_METHOD;
export type FacebookCaptureProvenance = "zapier" | "meta";

/**
 * Superset of the Zapier field shape. Meta Graph adds the publishing platform
 * and the raw custom-question answers; both are omitted from the payload when
 * absent so Zapier output is byte-for-byte unchanged.
 */
export type FacebookCaptureFields = ZapierFacebookCaptureFields & {
  platform?: string | null;
  customFields?: Record<string, string> | null;
};

export const FACEBOOK_CAPTURE_SCHEMA_VERSION = "sa360.facebook_capture.v1";
export const FACEBOOK_CAPTURE_INVENTORY_NOT_TRACKED = "capture_only_facebook_intake_does_not_track_inventory";

function omitEmpty(entries: Array<[string, string | null | undefined]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isoOrNull(value: string | null | undefined): string | null {
  const trimmed = trimOrNull(value);
  if (!trimmed) return null;
  const millis = Date.parse(trimmed);
  return Number.isNaN(millis) ? null : new Date(millis).toISOString();
}

/**
 * Convert the merged Graph + webhook-envelope shape into capture fields.
 * Page/Form IDs are validated with the same reader Zapier uses so an unsafe or
 * malformed ID yields `formIdentityStatus: "invalid"` instead of a bad lookup.
 */
export function captureFieldsFromFacebookLeadFields(fields: FacebookLeadFields): FacebookCaptureFields {
  const page = fields.pageId ? readFacebookId(fields.pageId) : null;
  const form = fields.formId ? readFacebookId(fields.formId) : null;
  let formIdentityStatus: FacebookCaptureFields["formIdentityStatus"] = "present";
  if ((page && !page.ok) || (form && !form.ok)) {
    formIdentityStatus = "invalid";
  } else if (!page?.ok || !form?.ok) {
    formIdentityStatus = "missing";
  }
  const phone = trimOrNull(fields.phone);
  const phoneResult = phone ? tryNormalizeToVerifiedE164(phone) : null;
  const custom = fields.custom && Object.keys(fields.custom).length > 0 ? fields.custom : null;
  return {
    leadgenId: fields.leadgenId.trim(),
    pageId: page?.ok ? page.value : null,
    formId: form?.ok ? form.value : null,
    formIdentityStatus,
    formName: trimOrNull(fields.formName),
    campaignId: trimOrNull(fields.campaignId),
    campaignName: trimOrNull(fields.campaignName),
    adsetId: trimOrNull(fields.adsetId),
    adsetName: trimOrNull(fields.adsetName),
    adId: trimOrNull(fields.adId),
    adName: trimOrNull(fields.adName),
    firstName: trimOrNull(fields.firstName),
    lastName: trimOrNull(fields.lastName),
    email: trimOrNull(fields.email),
    phone,
    phoneE164: phoneResult?.ok ? phoneResult.e164 : null,
    state: trimOrNull(fields.state),
    postalCode: trimOrNull(fields.zip),
    submittedAt: isoOrNull(fields.createdTime),
    platform: trimOrNull(fields.platform),
    customFields: custom,
  };
}

export function buildFacebookCaptureNormalizedPayload(input: {
  fields: FacebookCaptureFields;
  association: FacebookFormAssociationResolution;
  receivedAt: string;
  intakeMethod: FacebookCaptureIntakeMethod;
}): Record<string, unknown> {
  const { fields, association, receivedAt, intakeMethod } = input;
  const customFields =
    fields.customFields && Object.keys(fields.customFields).length > 0 ? fields.customFields : null;
  // Form questions arrive as custom fields. Promote an explicit age /
  // date-of-birth answer to the canonical nest commercial fulfillment reads.
  const leadDetails = withIntakeConsumerAge(null, [customFields ?? {}]);
  return {
    schema_version: FACEBOOK_CAPTURE_SCHEMA_VERSION,
    contact: omitEmpty([
      ["lead_uid", buildFacebookLeadUid(fields.leadgenId)],
      ["first_name", fields.firstName],
      ["last_name", fields.lastName],
      ["email", fields.email],
      ["phone", fields.phone],
      ["phone_e164", fields.phoneE164],
      ["state", fields.state],
      ["zip", fields.postalCode],
    ]),
    source: {
      provider: FACEBOOK_LEAD_PROVIDER,
      source_system: FACEBOOK_LEAD_SOURCE_SYSTEM,
      intake_method: intakeMethod,
      leadgen_id: fields.leadgenId,
      ...omitEmpty([
        ["page_id", fields.pageId],
        ["form_id", fields.formId],
        ["form_name", fields.formName],
        ["campaign_id", fields.campaignId],
        ["campaign_name", fields.campaignName],
        ["adset_id", fields.adsetId],
        ["adset_name", fields.adsetName],
        ["ad_id", fields.adId],
        ["ad_name", fields.adName],
        ["platform", fields.platform],
      ]),
      ...(fields.submittedAt ? { submitted_at: fields.submittedAt } : {}),
      received_at: receivedAt,
    },
    ...(customFields ? { custom_fields: customFields } : {}),
    ...(Object.keys(leadDetails).length > 0 ? { lead_details: leadDetails } : {}),
    association: {
      outcome: association.outcome,
      client_account_id: association.clientAccountId,
      source_funnel_id: association.sourceFunnelId,
      page_id: association.pageId,
      form_id: association.formId,
    },
  };
}

export function buildFacebookCaptureEnrichment(input: {
  fields: FacebookCaptureFields;
  association: FacebookFormAssociationResolution;
  receivedAt: string;
  intakeMethod: FacebookCaptureIntakeMethod;
  provenance: FacebookCaptureProvenance;
  audit?: unknown[];
}): Prisma.InputJsonObject {
  return {
    intakeMethod: input.intakeMethod,
    intakeProvenance: input.provenance,
    captureOnly: true,
    captureSettled: true,
    intakeStage: "capture_only",
    submittedAt: input.fields.submittedAt,
    receivedAt: input.receivedAt,
    association: {
      outcome: input.association.outcome,
      clientAccountId: input.association.clientAccountId,
      sourceFunnelId: input.association.sourceFunnelId,
      pageId: input.association.pageId,
      formId: input.association.formId,
      explanation: input.association.explanation,
    },
    inventory: {
      thisRequestTracked: false,
      historicalTracked: false,
      saleEligible: false,
      mutated: false,
      reason: FACEBOOK_CAPTURE_INVENTORY_NOT_TRACKED,
    },
    delivery: {
      thisRequestAttempted: false,
      historicalOutcome: "not_recorded",
    },
    associationAudit: (input.audit ?? []) as Prisma.InputJsonValue,
  };
}
