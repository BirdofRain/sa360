import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyOperatorOverrideToLiveBlock,
  evaluateDuplicateRisk,
  type DuplicateRiskLookupRow,
} from "./duplicate-risk.service.js";
import type { LeadIdentitySnapshot } from "./lead-identity.types.js";
import { namesSimilar } from "./lead-identity-extract.js";

function baseIdentity(overrides: Partial<LeadIdentitySnapshot> = {}): LeadIdentitySnapshot {
  return {
    sa360LeadUid: "LAL-NEW-001",
    masterContactIdGhl: null,
    clientContactIdGhl: null,
    facebookLeadId: null,
    facebookSubmissionId: null,
    appointmentId: null,
    normalizedPhone: "+15551234567",
    normalizedEmail: "new@example.com",
    firstName: "Alex",
    lastName: "Rivera",
    fullName: "Alex Rivera",
    clientAccountId: "master_client",
    destinationClientAccountId: "dest_client",
    destinationSubaccountIdGhl: "loc_dest",
    campaignId: "camp_1",
    utmCampaign: "vet_fb",
    nicheKey: "vet",
    sourceType: "facebook_lead_form",
    eventNameInternal: "lead_created",
    eventReceivedAt: new Date("2026-05-01T12:00:00Z"),
    ...overrides,
  };
}

function lookupRow(overrides: Partial<DuplicateRiskLookupRow> = {}): DuplicateRiskLookupRow {
  return {
    leadUid: "LAL-EXISTING-001",
    contactIdGhl: "ghl_contact_old",
    phoneE164: "+15559876543",
    email: "existing@example.com",
    displayName: "Alex Rivera",
    clientAccountId: "dest_client",
    subaccountIdGhl: "loc_dest",
    lastSeenAt: new Date("2026-04-28T10:00:00Z"),
    ...overrides,
  };
}

function mockLookup(overrides: Partial<DuplicateRiskEvaluationInput["lookup"]> = {}) {
  return {
    byFacebookLeadId: async () => [],
    byFacebookSubmissionId: async () => [],
    byPhone: async () => null,
    byEmail: async () => null,
    byLeadUid: async () => null,
    byNameCampaignProximity: async () => [],
    ...overrides,
  };
}

type DuplicateRiskEvaluationInput = Parameters<typeof evaluateDuplicateRisk>[0];

describe("evaluateDuplicateRisk", () => {
  it("exact phone duplicate = likely_duplicate", async () => {
    const result = await evaluateDuplicateRisk({
      identity: baseIdentity({ normalizedPhone: "+15551112222" }),
      excludeLeadUid: "LAL-NEW-001",
      lookup: mockLookup({
        byPhone: async () => lookupRow({ phoneE164: "+15551112222", leadUid: "LAL-OTHER" }),
      }),
    });
    assert.equal(result.riskLevel, "likely_duplicate");
    assert.equal(result.confidence, "high");
    assert.equal(result.blocksLiveDelivery, true);
  });

  it("exact email duplicate = likely_duplicate", async () => {
    const result = await evaluateDuplicateRisk({
      identity: baseIdentity({ normalizedPhone: null, normalizedEmail: "dup@example.com" }),
      lookup: mockLookup({
        byEmail: async () => lookupRow({ email: "dup@example.com" }),
      }),
    });
    assert.equal(result.riskLevel, "likely_duplicate");
    assert.equal(result.blocksLiveDelivery, true);
  });

  it("same facebookLeadId = source_duplicate", async () => {
    const result = await evaluateDuplicateRisk({
      identity: baseIdentity({ facebookLeadId: "fb_lead_999" }),
      lookup: mockLookup({
        byFacebookLeadId: async () => [lookupRow({ facebookLeadId: "fb_lead_999" })],
      }),
    });
    assert.equal(result.riskLevel, "source_duplicate");
    assert.equal(result.blocksLiveDelivery, true);
  });

  it("similar name + same campaign window + different phone/email = possible_duplicate", async () => {
    const result = await evaluateDuplicateRisk({
      identity: baseIdentity({
        normalizedPhone: "+15550000001",
        normalizedEmail: "unique@example.com",
        fullName: "Alex Rivera",
      }),
      lookup: mockLookup({
        byNameCampaignProximity: async () => [
          lookupRow({
            phoneE164: "+15550000002",
            email: "other@example.com",
            displayName: "Alex Rivera",
          }),
        ],
      }),
    });
    assert.equal(result.riskLevel, "possible_duplicate");
    assert.equal(result.blocksLiveDelivery, false);
    assert.ok(result.reasons.some((r) => r.includes("different contact identifiers")));
  });

  it("different phone/email + same name does not auto-merge to likely_duplicate", async () => {
    const result = await evaluateDuplicateRisk({
      identity: baseIdentity({
        normalizedPhone: "+15550000001",
        normalizedEmail: "a@example.com",
      }),
      lookup: mockLookup({
        byPhone: async () => null,
        byEmail: async () => null,
        byNameCampaignProximity: async () => [
          lookupRow({
            phoneE164: "+15550000099",
            email: "b@example.com",
            displayName: "Alex Rivera",
          }),
        ],
      }),
    });
    assert.notEqual(result.riskLevel, "likely_duplicate");
    assert.notEqual(result.riskLevel, "source_duplicate");
  });

  it("self-booked appointment without lead_created = orphan_appointment", async () => {
    const result = await evaluateDuplicateRisk({
      identity: baseIdentity({
        eventNameInternal: "appointment_set",
        appointmentId: "appt_1",
      }),
      priorLeadCreatedFound: false,
      lookup: mockLookup(),
    });
    assert.equal(result.identityStatus, "orphan_appointment");
  });

  it("namesSimilar requires overlap not exact substring only for short names", () => {
    assert.equal(namesSimilar("Alex Rivera", "Alex Rivera Smith"), true);
    assert.equal(namesSimilar("Alex Rivera", "Jordan Lee"), false);
  });
});

describe("applyOperatorOverrideToLiveBlock", () => {
  it("likely/source duplicate blocks future live delivery without override", () => {
    assert.equal(
      applyOperatorOverrideToLiveBlock(
        { riskLevel: "likely_duplicate", blocksLiveDelivery: true },
        null
      ),
      true
    );
  });

  it("separate_person override clears live block", () => {
    assert.equal(
      applyOperatorOverrideToLiveBlock(
        { riskLevel: "likely_duplicate", blocksLiveDelivery: true },
        "separate_person"
      ),
      false
    );
  });

  it("same_person override still blocks likely duplicate", () => {
    assert.equal(
      applyOperatorOverrideToLiveBlock(
        { riskLevel: "likely_duplicate", blocksLiveDelivery: true },
        "same_person"
      ),
      true
    );
  });
});
