import test from "node:test";
import assert from "node:assert/strict";

import { readNormalizedLeadIdentity } from "./normalized-lead-identity.js";

test("reads flat normalized payload fields", () => {
  const identity = readNormalizedLeadIdentity({
    phone_e164: "+15555550123",
    email: "jane@example.com",
    state: "NC",
  });
  assert.deepEqual(identity, {
    phoneE164: "+15555550123",
    email: "jane@example.com",
    state: "NC",
  });
});

test("reads nested contact payload fields", () => {
  const identity = readNormalizedLeadIdentity({
    contact: {
      phone_e164: "+15555550999",
      email: "meta@example.com",
      state: "Texas",
    },
  });
  assert.deepEqual(identity, {
    phoneE164: "+15555550999",
    email: "meta@example.com",
    state: "Texas",
  });
});

test("prefers top-level fields when flat and nested shapes coexist", () => {
  const identity = readNormalizedLeadIdentity({
    phone_e164: "+15555550111",
    email: "top@example.com",
    stateCode: "TX",
    contact: {
      phone_e164: "+15555550222",
      email: "nested@example.com",
      state: "Texas",
    },
  });
  assert.deepEqual(identity, {
    phoneE164: "+15555550111",
    email: "top@example.com",
    state: "TX",
  });
});

test("ignores malformed contact object and still reads top-level fields", () => {
  const identity = readNormalizedLeadIdentity({
    contact: "not-an-object",
    phone: "+15555550333",
    email: "flat@example.com",
    state: "CA",
  });
  assert.deepEqual(identity, {
    phoneE164: "+15555550333",
    email: "flat@example.com",
    state: "CA",
  });
});

test("ignores empty trimmed fields", () => {
  const identity = readNormalizedLeadIdentity({
    phone_e164: "   ",
    email: "",
    contact: { phone: "+15555550444", email: "  ", state: "FL" },
  });
  assert.deepEqual(identity, {
    phoneE164: "+15555550444",
    email: null,
    state: "FL",
  });
});

test("reads production-shaped Facebook Meta payload", () => {
  const identity = readNormalizedLeadIdentity({
    contact: {
      phone_e164: "+15551234567",
      email: "lead@example.com",
      state: "Texas",
      first_name: "Jane",
      last_name: "Doe",
    },
    source: "facebook",
  });
  assert.deepEqual(identity, {
    phoneE164: "+15551234567",
    email: "lead@example.com",
    state: "Texas",
  });
});

test("reads Google Sheets production shape with flat fields", () => {
  const identity = readNormalizedLeadIdentity({
    phoneE164: "+15559876543",
    email: "sheet@example.com",
    stateCode: "GA",
    rowNumber: 42,
  });
  assert.deepEqual(identity, {
    phoneE164: "+15559876543",
    email: "sheet@example.com",
    state: "GA",
  });
});

test("returns null for malformed non-object payloads", () => {
  assert.equal(readNormalizedLeadIdentity(null), null);
  assert.equal(readNormalizedLeadIdentity("bad"), null);
  assert.equal(readNormalizedLeadIdentity([]), null);
});
