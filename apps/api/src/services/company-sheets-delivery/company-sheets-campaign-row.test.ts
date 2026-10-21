import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
  COMPANY_SHEETS_LEAD_HEADER,
  COMPANY_SHEETS_LEAD_HEADER_V2,
  companySheetsCampaignHeader,
} from "../../lib/company-google-sheets-env.js";
import { companySheetsCampaignRowValues } from "./company-sheets-campaign-row.js";

const EXCLUDED = {
  ip: "203.0.113.50",
  agent: "SecretAgent/9",
  fbclid: "fbclid-secret",
  dob: "1979-04-12",
  disability: "40%",
  cert: "https://cert.example/secret",
};

function row(schemaVersion: string, payload: unknown, sourceLeadId: string | null = "provider-1") {
  return companySheetsCampaignRowValues({
    schemaVersion,
    stableRowId: "lead:client:evt",
    clientAccountId: "client",
    sourceLeadEventId: "evt",
    receivedAt: "2026-10-21T21:00:00.000Z",
    sourceLeadId,
    normalizedPayload: payload,
  });
}

function asMap(values: string[]): Record<string, string> {
  assert.equal(values.length, COMPANY_SHEETS_LEAD_HEADER_V2.length);
  return Object.fromEntries(COMPANY_SHEETS_LEAD_HEADER_V2.map((key, index) => [key, values[index] ?? ""]));
}

function excluded(payload: Record<string, unknown>) {
  return {
    ...payload,
    rawPayloadJson: { secret: "raw-json" },
    ip_address: EXCLUDED.ip,
    user_agent: EXCLUDED.agent,
    fbclid: EXCLUDED.fbclid,
    date_of_birth: EXCLUDED.dob,
    disability_rating: EXCLUDED.disability,
  };
}

/** Campaign-rule shape: canonical campaign id route, niche branch, no verification. */
function campaignRulePayload() {
  return excluded({
    phone: "5550100",
    contact: {
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      phone: "+15550009999",
      phone_e164: "+15555550100",
      state: "TX",
      lead_uid: "leadcapture_io:lc-rule-1",
    },
    lead_details: {
      consumer_age: "47",
      coverage_amount: "$50,000",
      date_of_birth: EXCLUDED.dob,
      niche: { branch_of_service: "Army", disability_rating: EXCLUDED.disability },
    },
    routing: {
      source_intake: {
        lead_id: "lc-rule-1",
        source_lead_id_generated: false,
        submitted_at: "2026-10-21T20:59:00.000Z",
        sourceAttributes: {
          age: "99",
          best_time_to_call: "Evening",
          branch_of_service: "Navy",
          military_status: "Veteran",
          desired_coverage: "$100,000+",
          coverage_amount: "$10,000",
          primary_reason: "Family",
          marital_status: "Married",
          sex: "Female",
          ip_address: EXCLUDED.ip,
          user_agent: EXCLUDED.agent,
          fbclid: EXCLUDED.fbclid,
          date_of_birth: EXCLUDED.dob,
          disability_rating: EXCLUDED.disability,
          trustedform_cert_url: EXCLUDED.cert,
        },
        unmappedSourceFieldsJson: [{ key: "is_partial_lead", value: "false" }],
      },
    },
  });
}

/** Confirmed parent-url association shape, including verification and TrustedForm status. */
function sourceAssociationPayload() {
  return excluded({
    contact: {
      first_name: "Grace",
      last_name: "Hopper",
      email: "grace@example.com",
      phone_e164: "+15555550101",
      state: "VA",
    },
    lead_details: {
      beneficiary: "Spouse",
      coverage_amount: "",
    },
    routing: {
      source_intake: {
        lead_id: "lc-page-9",
        source_lead_id_generated: false,
        submitted_at: "2026-10-21T20:10:00.000Z",
        sourceAttributes: {
          age: "64",
          best_time_to_call: "Morning",
          branch_of_service: "Navy",
          military_status: "Retired",
          desired_coverage: "$250,000",
          primary_reason: "Burial",
          marital_status: "Widowed",
          sex: "Female",
          beneficiary: "Child",
          phone_verified: true,
          email_verified: false,
          ip_address: EXCLUDED.ip,
          user_agent: EXCLUDED.agent,
          fbclid: EXCLUDED.fbclid,
          trustedform_cert_url: EXCLUDED.cert,
        },
        unmappedSourceFieldsJson: [
          { key: "time_to_completion_minutes", value: 12 },
          { key: "trustedformCaptureStatus", value: "captured" },
          { key: "xxTrustedFormCertUrl", value: EXCLUDED.cert },
        ],
      },
    },
  });
}

test("v1 and v2 headers stay distinct and v1 is unchanged", () => {
  assert.deepEqual(companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION), COMPANY_SHEETS_LEAD_HEADER);
  assert.equal(COMPANY_SHEETS_LEAD_HEADER.length, 7);
  assert.deepEqual(
    companySheetsCampaignHeader(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2),
    COMPANY_SHEETS_LEAD_HEADER_V2
  );
  assert.deepEqual(COMPANY_SHEETS_LEAD_HEADER_V2.slice(0, 7), [...COMPANY_SHEETS_LEAD_HEADER]);
  assert.equal(companySheetsCampaignHeader("company_sheets_campaign_v9"), null);
  const header: readonly string[] = COMPANY_SHEETS_LEAD_HEADER_V2;
  assert.equal(header.includes("date_of_birth"), false);
  assert.equal(header.includes("disability_rating"), false);
  assert.equal(header.includes("ip_address"), false);
  assert.equal(header.includes("user_agent"), false);
  assert.equal(header.includes("fbclid"), false);
});

test("campaign rule and source association leads share the v2 contract", () => {
  const rule = asMap(row(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2, campaignRulePayload(), "ignored") ?? []);
  assert.equal(rule.full_name, "Ada Lovelace");
  assert.equal(rule.first_name, "Ada");
  assert.equal(rule.last_name, "Lovelace");
  assert.equal(rule.email, "ada@example.com");
  assert.equal(rule.phone, "5550100");
  assert.equal(rule.state, "TX");
  assert.equal(rule.provider_lead_id, "lc-rule-1");
  assert.equal(rule.consumer_age, "47");
  assert.equal(rule.best_time_to_call, "Evening");
  assert.equal(rule.branch_of_service, "Army");
  assert.equal(rule.military_status, "Veteran");
  assert.equal(rule.coverage_amount, "$50,000");
  assert.equal(rule.primary_reason, "Family");
  assert.equal(rule.marital_status, "Married");
  assert.equal(rule.sex, "Female");
  assert.equal(rule.beneficiary, "");
  assert.equal(rule.submitted_at, "2026-10-21T20:59:00.000Z");
  assert.equal(rule.completion_minutes, "");
  assert.equal(rule.phone_verified, "");
  assert.equal(rule.email_verified, "");
  assert.equal(rule.trustedform_status, "");

  const page = asMap(row(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2, sourceAssociationPayload()) ?? []);
  assert.equal(page.full_name, "Grace Hopper");
  assert.equal(page.phone, "+15555550101");
  assert.equal(page.state, "VA");
  assert.equal(page.provider_lead_id, "lc-page-9");
  assert.equal(page.consumer_age, "64");
  assert.equal(page.branch_of_service, "Navy");
  assert.equal(page.coverage_amount, "$250,000");
  assert.equal(page.beneficiary, "Spouse");
  assert.equal(page.completion_minutes, "12");
  assert.equal(page.phone_verified, "true");
  assert.equal(page.email_verified, "false");
  assert.equal(page.trustedform_status, "captured");
  assert.equal(page.submitted_at, "2026-10-21T20:10:00.000Z");
});

test("missing answers stay blank and excluded values are not copied", () => {
  const values = row(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2, {
    contact: { first_name: "Ada", email: "ada@example.com" },
    lead_details: { date_of_birth: EXCLUDED.dob },
    routing: {
      source_intake: {
        source_lead_id_generated: true,
        lead_id: "gen-should-not-export",
        sourceAttributes: {
          ip_address: EXCLUDED.ip,
          user_agent: EXCLUDED.agent,
          fbclid: EXCLUDED.fbclid,
          trustedform_cert_url: EXCLUDED.cert,
          date_of_birth: EXCLUDED.dob,
          disability_rating: EXCLUDED.disability,
        },
      },
    },
  }, "gen-should-not-export");
  const mapped = asMap(values ?? []);
  assert.equal(mapped.last_name, "");
  assert.equal(mapped.state, "");
  assert.equal(mapped.provider_lead_id, "");
  assert.equal(mapped.consumer_age, "");
  assert.equal(mapped.branch_of_service, "");
  assert.equal(mapped.coverage_amount, "");
  assert.equal(mapped.full_name, "Ada");
  const joined = values?.join("|") ?? "";
  for (const secret of Object.values(EXCLUDED)) assert.equal(joined.includes(secret), false);
  assert.equal(joined.includes("gen-should-not-export"), false);
  assert.equal(joined.includes("raw-json"), false);

  const legacy = row(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION, campaignRulePayload());
  assert.deepEqual(legacy, [
    "lead:client:evt",
    "client",
    "evt",
    "2026-10-21T21:00:00.000Z",
    "Ada Lovelace",
    "ada@example.com",
    "5550100",
  ]);
});

test("stored James Torrey shapes keep exact unmapped paths, false flags, and conflicts", () => {
  const cert = "https://cert.example/xx-secret";
  const rule = asMap(
    row(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2, {
      state: { lifecycle_stage: "NEW", routing_status: "RECEIVED", lead_type: "VET" },
      time_to_completion_minutes: 99,
      trustedformCaptureStatus: "decoy-status",
      contact: {
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        phone_e164: "+15555550100",
        state: "TX",
      },
      lead_details: {
        consumer_age: "47",
        coverage_amount: "$50,000",
        niche: { branch_of_service: "Army" },
      },
      routing: {
        source_intake: {
          lead_id: "lc-rule-1",
          source_lead_id_generated: false,
          submitted_at: "2026-10-21T20:59:00.000Z",
          sourceAttributes: {
            age: 99,
            best_time_to_call: "Evening",
            branch_of_service: "Navy",
            military_status: "Veteran",
            desired_coverage: "$100,000+",
            primary_reason: "Family",
            marital_status: "Married",
            sex: "Female",
          },
          compliance: {
            trustedformCaptureStatus: "decoy-status",
            time_to_completion_minutes: 99,
          },
          unmappedSourceFieldsJson: [
            { key: "is_partial_lead", value: false },
            { key: "is_verified_lead", value: false },
          ],
        },
      },
    }) ?? []
  );
  assert.equal(rule.state, "TX");
  assert.equal(rule.consumer_age, "47");
  assert.equal(rule.branch_of_service, "Army");
  assert.equal(rule.coverage_amount, "$50,000");
  assert.equal(rule.completion_minutes, "");
  assert.equal(rule.trustedform_status, "");
  assert.equal(rule.phone_verified, "");
  assert.equal(rule.email_verified, "");
  assert.equal(rule.beneficiary, "");
  assert.equal(rule.provider_lead_id, "lc-rule-1");
  assert.equal(JSON.stringify(rule).includes("decoy-status"), false);
  assert.equal(JSON.stringify(rule).includes("99"), false);

  const association = asMap(
    row(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2, {
      state: { lifecycle_stage: "NEW", routing_status: "RECEIVED" },
      time_to_completion_minutes: 99,
      contact: {
        first_name: "Grace",
        last_name: "Hopper",
        email: "grace@example.com",
        phone_e164: "+15555550101",
        state: "VA",
      },
      lead_details: {
        consumer_age: "64",
        coverage_amount: "$250,000",
        beneficiary: "Spouse",
      },
      routing: {
        source_intake: {
          lead_id: "lc-page-9",
          source_lead_id_generated: false,
          submitted_at: "2026-10-21T20:10:00.000Z",
          sourceAttributes: {
            age: 70,
            desired_coverage: "$100,000",
            coverage_amount: "$10,000",
            branch_of_service: "Navy",
            beneficiary: "Child",
            phone_verified: false,
            email_verified: false,
          },
          compliance: {
            phone_verified: true,
            email_verified: true,
            trustedformCaptureStatus: "decoy-status",
          },
          unmappedSourceFieldsJson: [
            { key: "time_to_completion_minutes", value: 12 },
            { key: "trustedformCaptureStatus", value: "captured" },
            { key: "xxTrustedFormCertUrl", value: cert },
          ],
        },
      },
    }) ?? []
  );
  assert.equal(association.consumer_age, "64");
  assert.equal(association.coverage_amount, "$250,000");
  assert.equal(association.beneficiary, "Spouse");
  assert.equal(association.branch_of_service, "Navy");
  assert.equal(association.phone_verified, "false");
  assert.equal(association.email_verified, "false");
  assert.equal(association.completion_minutes, "12");
  assert.equal(association.trustedform_status, "captured");
  assert.equal(association.submitted_at, "2026-10-21T20:10:00.000Z");
  assert.equal(JSON.stringify(association).includes(cert), false);
  assert.equal(JSON.stringify(association).includes("decoy-status"), false);
  assert.equal(JSON.stringify(association).includes("99"), false);

  const blanks = asMap(
    row(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2, {
      state: { lifecycle_stage: "NEW" },
      contact: { first_name: "Grace", email: "grace@example.com" },
      lead_details: {
        consumer_age: "  ",
        coverage_amount: "",
        beneficiary: "",
        niche: { branch_of_service: " " },
      },
      routing: {
        source_intake: {
          submitted_at: "   ",
          sourceAttributes: {
            age: 64,
            desired_coverage: "",
            coverage_amount: "$10,000",
            branch_of_service: "Navy",
            beneficiary: "Child",
            phone_verified: false,
            email_verified: true,
          },
          unmappedSourceFieldsJson: [
            { key: "time_to_completion_minutes", value: "  " },
            { key: "trustedformCaptureStatus", value: "" },
          ],
        },
      },
    }) ?? []
  );
  assert.equal(blanks.state, "");
  assert.equal(blanks.consumer_age, "64");
  assert.equal(blanks.branch_of_service, "Navy");
  assert.equal(blanks.coverage_amount, "$10,000");
  assert.equal(blanks.beneficiary, "Child");
  assert.equal(blanks.submitted_at, "");
  assert.equal(blanks.completion_minutes, "");
  assert.equal(blanks.trustedform_status, "");
  assert.equal(blanks.phone_verified, "false");
  assert.equal(blanks.email_verified, "true");
  assert.equal(JSON.stringify(blanks).includes("[object Object]"), false);
});
