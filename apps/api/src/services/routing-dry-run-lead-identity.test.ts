import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRoutingLeadIdentity } from "./routing-dry-run-lead-identity.js";

test("normalizeRoutingLeadIdentity reads snake_case contact fields", () => {
  const identity = normalizeRoutingLeadIdentity({
    contact: {
      first_name: "Sam",
      last_name: "Tester",
      full_name: "Sam Tester",
      phone_e164: "+15550100111",
      email: "sam.canary.tester.003@example.test",
    },
  });
  assert.ok(identity);
  assert.equal(identity?.leadName, "Sam Tester");
  assert.equal(identity?.firstName, "Sam");
  assert.equal(identity?.lastName, "Tester");
  assert.equal(identity?.phone, "+15550100111");
  assert.equal(identity?.email, "sam.canary.tester.003@example.test");
});

test("normalizeRoutingLeadIdentity reads camelCase contact fields", () => {
  const identity = normalizeRoutingLeadIdentity({
    contact: {
      firstName: "Sam",
      lastName: "Tester",
      fullName: "Sam Tester",
      phoneE164: "+15550100112",
      email: "sam.camel@example.test",
    },
  });
  assert.ok(identity);
  assert.equal(identity?.leadName, "Sam Tester");
  assert.equal(identity?.phone, "+15550100112");
  assert.equal(identity?.email, "sam.camel@example.test");
});

test("normalizeRoutingLeadIdentity builds display name from first + last", () => {
  const identity = normalizeRoutingLeadIdentity({
    contact: {
      first_name: "Jamie",
      last_name: "Example",
    },
  });
  assert.ok(identity);
  assert.equal(identity?.leadName, "Jamie Example");
});

test("normalizeRoutingLeadIdentity falls back to raw.client_name", () => {
  const identity = normalizeRoutingLeadIdentity({
    contact: {},
    raw: {
      client_name: "Raw Client Name",
      phone: "+15550100222",
      email: "raw.client@example.test",
    },
  });
  assert.ok(identity);
  assert.equal(identity?.leadName, "Raw Client Name");
  assert.equal(identity?.phone, "+15550100222");
  assert.equal(identity?.email, "raw.client@example.test");
});

test("normalizeRoutingLeadIdentity reads phone_raw and contact.email fallback", () => {
  const identity = normalizeRoutingLeadIdentity({
    contact: {
      phone_raw: "(555) 010-0333",
      email: "phone.raw@example.test",
    },
  });
  assert.ok(identity);
  assert.equal(identity?.phone, "(555) 010-0333");
  assert.equal(identity?.email, "phone.raw@example.test");
});
