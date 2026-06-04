import assert from "node:assert/strict";
import test from "node:test";

import { extractIdsFromQuery, parseQueryParams } from "./capture-context.ts";

test("parseQueryParams extracts trimmed values", () => {
  const q = parseQueryParams("?clientAccountId=abc&empty=");
  assert.equal(q.clientAccountId, "abc");
  assert.equal(q.empty, undefined);
});

test("extractIdsFromQuery reads known keys", () => {
  const ids = extractIdsFromQuery({
    masterClientAccountId: "master_1",
    clientAccountId: "client_1",
    destinationSubaccountIdGhl: "loc_1",
  });
  assert.equal(ids.masterClientAccountId, "master_1");
  assert.equal(ids.subaccountIdGhl, "loc_1");
});
