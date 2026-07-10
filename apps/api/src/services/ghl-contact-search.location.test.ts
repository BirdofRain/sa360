import test from "node:test";
import assert from "node:assert/strict";

import {
  emailsMatchExactly,
  phonesMatchExactly,
  searchGhlContactsAtLocation,
} from "./ghl-contact-search.service.js";

test("phonesMatchExactly normalizes punctuation and country prefix", () => {
  assert.equal(phonesMatchExactly("+15551234567", "(555) 123-4567"), true);
  assert.equal(phonesMatchExactly("+15551234567", "5551234567"), true);
  assert.equal(phonesMatchExactly("+15551234567", "+1 555-123-4567"), true);
});

test("emailsMatchExactly is case-insensitive", () => {
  assert.equal(emailsMatchExactly("Lead@Example.com", "lead@example.com"), true);
});

test("fuzzy GHL phone result is not treated as an exact match", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        contacts: [{ id: "c1", phone: "+15559999999", firstName: "Other" }],
      }),
      { status: 200 }
    );

  const result = await searchGhlContactsAtLocation({
    locationId: "loc_1",
    accessToken: "token",
    query: "+15551234567",
    identityType: "phone",
    fetchImpl,
  });
  assert.equal(result.kind, "not_found");
});

test("contact missing queried phone cannot be an exact phone match", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        contacts: [{ id: "c1", email: "lead@example.com", firstName: "NoPhone" }],
      }),
      { status: 200 }
    );

  const result = await searchGhlContactsAtLocation({
    locationId: "loc_1",
    accessToken: "token",
    query: "+15551234567",
    identityType: "phone",
    fetchImpl,
  });
  assert.equal(result.kind, "not_found");
});

test("formatted phone values normalize to the same exact match", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        contacts: [{ id: "c1", phone: "(555) 123-4567", firstName: "Jane" }],
      }),
      { status: 200 }
    );

  const result = await searchGhlContactsAtLocation({
    locationId: "loc_1",
    accessToken: "token",
    query: "+15551234567",
    identityType: "phone",
    fetchImpl,
  });
  assert.equal(result.kind, "matched");
  if (result.kind === "matched") {
    assert.equal(result.contact.contactIdGhl, "c1");
  }
});

test("case-different emails normalize to the same exact match", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        contacts: [{ id: "c1", email: "Lead@Example.com", firstName: "Jane" }],
      }),
      { status: 200 }
    );

  const result = await searchGhlContactsAtLocation({
    locationId: "loc_1",
    accessToken: "token",
    query: "lead@example.com",
    identityType: "email",
    fetchImpl,
  });
  assert.equal(result.kind, "matched");
});

test("multiple exact phone matches are ambiguous", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        contacts: [
          { id: "c1", phone: "+15551234567" },
          { id: "c2", phone: "5551234567" },
        ],
      }),
      { status: 200 }
    );

  const result = await searchGhlContactsAtLocation({
    locationId: "loc_1",
    accessToken: "token",
    query: "+15551234567",
    identityType: "phone",
    fetchImpl,
  });
  assert.equal(result.kind, "ambiguous");
  if (result.kind === "ambiguous") {
    assert.equal(result.matchCount, 2);
  }
});

test("malformed GHL response is unverifiable", async () => {
  const fetchImpl = async () => new Response("not-json", { status: 200 });

  const result = await searchGhlContactsAtLocation({
    locationId: "loc_1",
    accessToken: "token",
    query: "+15551234567",
    identityType: "phone",
    fetchImpl,
  });
  assert.equal(result.kind, "unverifiable");
});

test("searchGhlContactsAtLocation returns error on timeout", async () => {
  const fetchImpl = async () => {
    throw new DOMException("timeout", "TimeoutError");
  };

  const result = await searchGhlContactsAtLocation({
    locationId: "loc_1",
    accessToken: "token",
    query: "+15551234567",
    identityType: "phone",
    fetchImpl,
    timeoutMs: 5,
  });
  assert.equal(result.kind, "error");
});
