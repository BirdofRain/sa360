import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyIncompleteLeadIdentity,
  extractSourceLeadEventIdentity,
  type LeadIdentitySnapshot,
  type LeadIdentitySupport,
} from "./incomplete-lead-audit.js";

const fullSupport: LeadIdentitySupport = {
  fullName: true,
  phone: true,
  email: true,
  leadUid: true,
  contactIdGhl: true,
  subaccountIdGhl: true,
  orderId: true,
  routingRuleId: true,
  deliveryAttemptId: true,
};

function snapshot(overrides: Partial<LeadIdentitySnapshot> = {}): LeadIdentitySnapshot {
  return {
    clientAccountId: null,
    clientName: null,
    firstName: null,
    lastName: null,
    fullName: null,
    phone: null,
    email: null,
    leadUid: null,
    contactIdGhl: null,
    subaccountIdGhl: null,
    orderId: null,
    routingRuleId: null,
    deliveryAttemptId: null,
    ...overrides,
  };
}

test("missing client + first + last with no other identity is markable", () => {
  const result = classifyIncompleteLeadIdentity(snapshot(), fullSupport);
  assert.equal(result.action, "mark");
  assert.equal(result.status, "INCOMPLETE_MISSING_CLIENT_AND_NAME");
});

test("whitespace-only source lead identity fields normalize to missing", () => {
  const extracted = extractSourceLeadEventIdentity({
    clientAccountIdResolved: "   ",
    destinationLocationIdResolved: " ",
    routingRuleIdResolved: " ",
    sourceLeadUid: " ",
    normalizedPayloadJson: {
      contact: {
        first_name: "  ",
        last_name: " ",
        phone_e164: " ",
        email: " ",
        contact_id_ghl: " ",
      },
    },
  });
  const result = classifyIncompleteLeadIdentity(extracted.snapshot, extracted.support);
  assert.equal(result.action, "mark");
});

test("phone or email with missing names/client becomes review_required", () => {
  const result = classifyIncompleteLeadIdentity(
    snapshot({
      phone: "+15550120000",
    }),
    fullSupport
  );
  assert.equal(result.action, "review_required");
  assert.equal(result.status, "REVIEW_REQUIRED_INCOMPLETE_IDENTITY");
});

test("clientAccountId present without names is preserved", () => {
  const result = classifyIncompleteLeadIdentity(
    snapshot({
      clientAccountId: "client_123",
    }),
    fullSupport
  );
  assert.equal(result.action, "keep");
});

test("first or last name present is preserved", () => {
  const first = classifyIncompleteLeadIdentity(
    snapshot({
      firstName: "Alex",
    }),
    fullSupport
  );
  assert.equal(first.action, "keep");

  const last = classifyIncompleteLeadIdentity(
    snapshot({
      lastName: "Taylor",
    }),
    fullSupport
  );
  assert.equal(last.action, "keep");
});
