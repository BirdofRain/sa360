import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildAgedInventoryNormalizedPayload } from "../aged-inventory-import/aged-inventory-import-consumer-age.js";
import {
  buildFacebookCaptureNormalizedPayload,
  type FacebookCaptureFields,
} from "../source-intake/facebook-capture-record.js";
import type { FacebookFormAssociationResolution } from "../source-intake/facebook-form-association.service.js";
import {
  normalizeFacebookLeadToLifecyclePayload,
  type FacebookLeadFields,
} from "../source-intake/facebook-lead-normalizer.js";
import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "../source-intake/leadcapture-io-normalizer.js";
import {
  resolveIntakeConsumerAgeFields,
  withIntakeConsumerAge,
  withNormalizedPayloadConsumerAge,
} from "./consumer-age-intake.js";
import { resolveConsumerAgeForFulfillment } from "./consumer-age-policy.js";

const EVALUATED_AT = new Date("2026-10-06T00:00:00.000Z");

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/leadcaptureio"
);

function leadCaptureFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as Record<string, unknown>;
}

function leadDetailsOf(payload: Record<string, unknown>): Record<string, unknown> {
  return (payload.lead_details ?? {}) as Record<string, unknown>;
}

test("intake consumer-age promotion", async (t) => {
  await t.test("promotes an explicit age answer under any recognized alias", () => {
    for (const key of ["age", "Age", "consumer_age", "Consumer Age"]) {
      assert.deepEqual(
        resolveIntakeConsumerAgeFields([{ [key]: "71" }], EVALUATED_AT),
        { consumer_age: "71" },
        `alias ${key}`
      );
    }
  });

  await t.test("promotes a DOB answer and derives the completed-whole-year age", () => {
    for (const key of ["dob", "DOB", "date_of_birth", "Date of Birth", "birth-date"]) {
      assert.deepEqual(
        resolveIntakeConsumerAgeFields([{ [key]: "1955-03-04" }], EVALUATED_AT),
        { consumer_age: "71", date_of_birth: "1955-03-04" },
        `alias ${key}`
      );
    }
  });

  await t.test("never fabricates a date of birth from an explicit age", () => {
    const resolved = resolveIntakeConsumerAgeFields([{ age: "62" }], EVALUATED_AT);
    assert.equal(resolved.consumer_age, "62");
    assert.equal("date_of_birth" in resolved, false);
  });

  await t.test("writes nothing when no explicit age source exists", () => {
    assert.deepEqual(
      resolveIntakeConsumerAgeFields(
        [{ generated_at: "2026-03-01", submitted_at: "2026-03-01", lead_age_days: 45 }],
        EVALUATED_AT
      ),
      {}
    );
    assert.deepEqual(withIntakeConsumerAge(null, [{ generated_at: "2026-03-01" }], EVALUATED_AT), {});
  });

  await t.test("never overwrites a non-blank canonical value", () => {
    const details = withIntakeConsumerAge(
      { consumer_age: "64", beneficiary: "Spouse" },
      [{ age: "71" }],
      EVALUATED_AT
    );
    assert.equal(details.consumer_age, "64");
    assert.equal(details.beneficiary, "Spouse");
  });

  await t.test("promotes an over-maximum age and leaves classification to the policy", () => {
    const details = withIntakeConsumerAge(null, [{ age: "92" }], EVALUATED_AT);
    assert.equal(details.consumer_age, "92");
    assert.equal(
      resolveConsumerAgeForFulfillment({
        normalizedPayloadJson: { lead_details: details },
        evaluatedAt: EVALUATED_AT,
      }).status,
      "over_maximum_age"
    );
  });

  await t.test("withNormalizedPayloadConsumerAge recovers a nested stored age", () => {
    const details = withNormalizedPayloadConsumerAge(
      null,
      [{ routing: { source_intake: { sourceAttributes: { dob: "1958-07-19" } } } }],
      EVALUATED_AT
    );
    assert.equal(details.consumer_age, "68");
    assert.equal(details.date_of_birth, "1958-07-19");
  });
});

test("LeadCapture.io intake normalizes consumer age", async (t) => {
  await t.test("legacy webhook promotes an explicit age answer", () => {
    const raw = { ...leadCaptureFixture("leadcaptureio-webhook-sample-legacy.json"), age: "85" };
    const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw);
    assert.equal(leadDetailsOf(normalized as unknown as Record<string, unknown>).consumer_age, "85");
  });

  await t.test("legacy webhook promotes a DOB answer and derives the age", () => {
    const raw = {
      ...leadCaptureFixture("leadcaptureio-webhook-sample-legacy.json"),
      date_of_birth: "1948-01-02",
    };
    const details = leadDetailsOf(
      normalizeLeadCaptureIoWebhookToLifecyclePayload(raw) as unknown as Record<string, unknown>
    );
    assert.equal(details.date_of_birth, "1948-01-02");
    assert.equal(typeof details.consumer_age, "string");
    assert.ok(Number(details.consumer_age) >= 78);
  });

  await t.test("nextgen webhook promotes an explicit age answer", () => {
    const raw = { ...leadCaptureFixture("leadcaptureio-webhook-sample-nextgen.json"), DOB: "1952-06-05" };
    const details = leadDetailsOf(
      normalizeLeadCaptureIoWebhookToLifecyclePayload(raw) as unknown as Record<string, unknown>
    );
    assert.equal(details.date_of_birth, "1952-06-05");
    assert.equal(typeof details.consumer_age, "string");
  });

  await t.test("a webhook without an age answer writes no canonical age", () => {
    const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(
      leadCaptureFixture("leadcaptureio-webhook-sample-legacy.json")
    ) as unknown as Record<string, unknown>;
    assert.equal(leadDetailsOf(normalized).consumer_age, undefined);
  });
});

function metaLeadFields(
  leadgenId: string,
  custom: Record<string, string>
): FacebookLeadFields {
  return {
    leadgenId,
    pageId: "page_1",
    formId: "form_9",
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.test",
    phone: "+14155550100",
    state: "Texas",
    custom,
  };
}

function captureFields(
  leadgenId: string,
  customFields: Record<string, string> | null
): FacebookCaptureFields {
  return {
    leadgenId,
    pageId: "page_1",
    formId: "form_9",
    formIdentityStatus: "present",
    formName: "Veteran FEX",
    campaignId: null,
    campaignName: null,
    adsetId: null,
    adsetName: null,
    adId: null,
    adName: null,
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.test",
    phone: "+14155550100",
    phoneE164: "+14155550100",
    state: "TX",
    postalCode: null,
    submittedAt: null,
    platform: null,
    customFields,
  };
}

const CAPTURE_ASSOCIATION: FacebookFormAssociationResolution = {
  outcome: "associated",
  clientAccountId: "acct_1",
  sourceFunnelId: "funnel_1",
  pageId: "page_1",
  formId: "form_9",
  explanation: "test fixture",
};

test("Meta / Zapier Facebook intake normalizes consumer age", async (t) => {
  await t.test("direct Meta lead promotes an age custom field", () => {
    const normalized = normalizeFacebookLeadToLifecyclePayload(
      metaLeadFields("lead_age_001", { "What is your age?": "ignored", age: "79" }),
      { masterClientAccountId: "lal_master_vet" }
    ) as unknown as Record<string, unknown>;
    assert.equal(leadDetailsOf(normalized).consumer_age, "79");
  });

  await t.test("direct Meta lead promotes a DOB custom field", () => {
    const normalized = normalizeFacebookLeadToLifecyclePayload(
      metaLeadFields("lead_age_002", { "Date of Birth": "1946-11-30" }),
      { masterClientAccountId: "lal_master_vet" }
    ) as unknown as Record<string, unknown>;
    const details = leadDetailsOf(normalized);
    assert.equal(details.date_of_birth, "1946-11-30");
    assert.equal(typeof details.consumer_age, "string");
  });

  await t.test("direct Meta lead without an age answer writes no canonical age", () => {
    const normalized = normalizeFacebookLeadToLifecyclePayload(
      metaLeadFields("lead_age_005", { "Best time to call": "morning" }),
      { masterClientAccountId: "lal_master_vet" }
    ) as unknown as Record<string, unknown>;
    assert.equal(leadDetailsOf(normalized).consumer_age, undefined);
  });

  await t.test("capture-only payload promotes a DOB custom field", () => {
    const payload = buildFacebookCaptureNormalizedPayload({
      fields: captureFields("lead_age_003", { dob: "1951-04-12" }),
      association: CAPTURE_ASSOCIATION,
      receivedAt: EVALUATED_AT.toISOString(),
      intakeMethod: "zapier_facebook",
    });
    const details = leadDetailsOf(payload);
    assert.equal(details.date_of_birth, "1951-04-12");
    assert.equal(typeof details.consumer_age, "string");
    assert.deepEqual(payload.custom_fields, { dob: "1951-04-12" });
  });

  await t.test("capture-only payload without an age answer writes no canonical age", () => {
    const payload = buildFacebookCaptureNormalizedPayload({
      fields: captureFields("lead_age_004", null),
      association: CAPTURE_ASSOCIATION,
      receivedAt: EVALUATED_AT.toISOString(),
      intakeMethod: "meta_lead_ads",
    });
    assert.equal("lead_details" in payload, false);
  });
});

test("aged CSV intake normalizes consumer age and date of birth", async (t) => {
  await t.test("an explicit age is stored canonically without a fabricated DOB", () => {
    const payload = buildAgedInventoryNormalizedPayload({
      firstName: "Ada",
      lastName: "Stone",
      email: "ada@example.test",
      phoneE164: "+15550105501",
      state: "IN",
      generatedAt: new Date("2026-02-01T00:00:00.000Z"),
      nicheKey: "vet",
      productType: null,
      consumerAge: "74",
    });
    const details = leadDetailsOf(payload);
    assert.equal(details.consumer_age, "74");
    assert.equal("date_of_birth" in details, false);
  });

  await t.test("a DOB column is stored canonically alongside the derived age", () => {
    const payload = buildAgedInventoryNormalizedPayload({
      firstName: "Ada",
      lastName: "Stone",
      email: "ada@example.test",
      phoneE164: "+15550105501",
      state: "IN",
      generatedAt: new Date("2026-02-01T00:00:00.000Z"),
      nicheKey: "vet",
      productType: null,
      consumerAge: "74",
      dateOfBirth: "1952-05-09",
    });
    const details = leadDetailsOf(payload);
    assert.equal(details.consumer_age, "74");
    assert.equal(details.date_of_birth, "1952-05-09");
  });
});
