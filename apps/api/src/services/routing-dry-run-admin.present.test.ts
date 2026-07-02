import test from "node:test";
import assert from "node:assert/strict";
import type { RoutingDryRunDecision } from "@prisma/client";
import {
  fallbackRoutingDryRunDecisionItem,
  hasUsableLeadIdentity,
  hydrateLeadIdentity,
  leadIdentityFromSourceNormalizedPayload,
  parseMatchTypeFromReason,
} from "./routing-dry-run-admin.present.js";

test("parseMatchTypeFromReason extracts tier from match reason", () => {
  assert.equal(
    parseMatchTypeFromReason("Matched routing rule (campaign_id) → Agent A"),
    "campaign_id"
  );
  assert.equal(parseMatchTypeFromReason("No active routing rule matched"), null);
});

test("fallbackRoutingDryRunDecisionItem serializes partial row safely", () => {
  const row = {
    id: "dec_partial",
    createdAt: new Date("2026-05-19T12:00:00.000Z"),
    sourceEventUuid: null,
    sourceLeadUid: "lead_1",
    matched: true,
    confidence: "high",
    matchType: null,
    matchedRuleId: "rule_missing",
    destinationClientAccountId: "client_1",
    destinationSubaccountIdGhl: null,
    matchReason: "Matched routing rule (campaign_id)",
    deliveryMode: "dry_run",
    routingEventNameInternal: "lead_matched",
    attributionSnapshot: null,
    masterClientAccountId: "lal_master_vet",
    legacyDeliveredClientAccountId: null,
    legacyDeliveredSubaccountIdGhl: null,
    legacyDeliveryContactIdGhl: null,
    legacyDeliveryStatus: null,
    validationStatus: "legacy_unknown",
    validationNotes: null,
    validatedAt: null,
    validatedBy: null,
    cleanupStatus: null,
    cleanupReason: null,
    cleanupMarkedAt: null,
  } as RoutingDryRunDecision;

  const item = fallbackRoutingDryRunDecisionItem(row);
  assert.equal(item.id, "dec_partial");
  assert.equal(item.validationStatus, "legacy_unknown");
  assert.equal(item.deliveryReadiness, null);
  assert.equal(item.duplicateRisk, null);
  assert.ok(item.suggestedValidation.suggestedValidationReason);
  assert.deepEqual(item.lifecycleEventsEmitted, ["lead_matched", "lead_routed_dry_run"]);
});

test("leadIdentityFromSourceNormalizedPayload reads first/last + phone_e164 + email", () => {
  const identity = leadIdentityFromSourceNormalizedPayload({
    contact: {
      first_name: "James",
      last_name: "Wilkins",
      phone_e164: "+17066210688",
      email: "james.wilkins@example.test",
      lead_uid: "leadcaptureio-leadcapture_io_legacy-4681191",
    },
  });
  assert.ok(identity);
  assert.equal(identity?.displayName, "James Wilkins");
  assert.equal(identity?.firstName, "James");
  assert.equal(identity?.lastName, "Wilkins");
  assert.equal(identity?.phoneE164, "+17066210688");
  assert.equal(identity?.email, "james.wilkins@example.test");
});

test("leadIdentityFromSourceNormalizedPayload supports full_name and phone fallback", () => {
  const identity = leadIdentityFromSourceNormalizedPayload({
    contact: { full_name: "Larry A. Rosebeck Jr.", phone: "+14403966094" },
  });
  assert.ok(identity);
  assert.equal(identity?.displayName, "Larry A. Rosebeck Jr.");
  assert.equal(identity?.phoneE164, "+14403966094");
});

test("leadIdentityFromSourceNormalizedPayload supports camelCase identity fields", () => {
  const identity = leadIdentityFromSourceNormalizedPayload({
    contact: {
      firstName: "Sam",
      lastName: "Tester",
      fullName: "Sam Tester",
      phoneE164: "+15550100111",
      email: "sam.canary.tester.003@example.test",
    },
  });
  assert.ok(identity);
  assert.equal(identity?.displayName, "Sam Tester");
  assert.equal(identity?.firstName, "Sam");
  assert.equal(identity?.lastName, "Tester");
  assert.equal(identity?.phoneE164, "+15550100111");
  assert.equal(identity?.email, "sam.canary.tester.003@example.test");
});

test("leadIdentityFromSourceNormalizedPayload falls back to raw.client_name and raw contact fields", () => {
  const identity = leadIdentityFromSourceNormalizedPayload({
    contact: {},
    raw: {
      client_name: "Fallback Client Name",
      phone: "+15550100999",
      email: "fallback.identity@example.test",
    },
  });
  assert.ok(identity);
  assert.equal(identity?.displayName, "Fallback Client Name");
  assert.equal(identity?.phoneE164, "+15550100999");
  assert.equal(identity?.email, "fallback.identity@example.test");
});

test("leadIdentityFromSourceNormalizedPayload returns null for empty/malformed payloads", () => {
  assert.equal(leadIdentityFromSourceNormalizedPayload(null), null);
  assert.equal(leadIdentityFromSourceNormalizedPayload({}), null);
  assert.equal(leadIdentityFromSourceNormalizedPayload({ contact: {} }), null);
});

test("hydrateLeadIdentity prefers source identity over blank lifecycle identity", () => {
  const source = leadIdentityFromSourceNormalizedPayload({
    contact: { first_name: "James", last_name: "Wilkins", phone_e164: "+17066210688" },
  });
  const blankLifecycle = {
    contactIdGhl: null,
    firstName: null,
    lastName: null,
    displayName: null,
    phoneE164: null,
    email: null,
  };
  const hydrated = hydrateLeadIdentity(blankLifecycle, source);
  assert.equal(hydrated?.displayName, "James Wilkins");
  assert.equal(hydrated?.phoneE164, "+17066210688");
});

test("hydrateLeadIdentity keeps non-blank lifecycle identity and ignores source", () => {
  const lifecycle = {
    contactIdGhl: "ghl_1",
    firstName: "Demo",
    lastName: "Dylan",
    displayName: "Demo Dylan",
    phoneE164: "+15550100099",
    email: null,
  };
  const source = leadIdentityFromSourceNormalizedPayload({
    contact: { first_name: "James", last_name: "Wilkins" },
  });
  const hydrated = hydrateLeadIdentity(lifecycle, source);
  assert.equal(hydrated?.displayName, "Demo Dylan");
  assert.equal(hydrated?.contactIdGhl, "ghl_1");
});

test("hasUsableLeadIdentity detects empty identity", () => {
  assert.equal(hasUsableLeadIdentity(null), false);
  assert.equal(
    hasUsableLeadIdentity({
      contactIdGhl: "ghl_1",
      firstName: null,
      lastName: null,
      displayName: null,
      phoneE164: null,
      email: null,
    }),
    false
  );
  assert.equal(
    hasUsableLeadIdentity({
      contactIdGhl: null,
      firstName: null,
      lastName: null,
      displayName: null,
      phoneE164: "+17066210688",
      email: null,
    }),
    true
  );
});
