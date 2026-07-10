import test from "node:test";
import assert from "node:assert/strict";

import { searchGhlContactsAtLocation } from "./ghl-contact-search.service.js";

test("searchGhlContactsAtLocation returns not_found for empty result set", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ contacts: [] }), { status: 200 });

  const result = await searchGhlContactsAtLocation({
    locationId: "loc_1",
    accessToken: "token",
    query: "+15551234567",
    fetchImpl,
  });
  assert.equal(result.kind, "not_found");
});

test("searchGhlContactsAtLocation returns ambiguous for multiple matches", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        contacts: [
          { id: "c1", firstName: "A", lastName: "One" },
          { id: "c2", firstName: "B", lastName: "Two" },
        ],
      }),
      { status: 200 }
    );

  const result = await searchGhlContactsAtLocation({
    locationId: "loc_1",
    accessToken: "token",
    query: "+15551234567",
    fetchImpl,
  });
  assert.equal(result.kind, "ambiguous");
  if (result.kind === "ambiguous") {
    assert.equal(result.matchCount, 2);
  }
});

test("searchGhlContactsAtLocation returns error on timeout", async () => {
  const fetchImpl = async () => {
    throw new DOMException("timeout", "TimeoutError");
  };

  const result = await searchGhlContactsAtLocation({
    locationId: "loc_1",
    accessToken: "token",
    query: "+15551234567",
    fetchImpl,
    timeoutMs: 5,
  });
  assert.equal(result.kind, "error");
});
