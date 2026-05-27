import test from "node:test";
import assert from "node:assert/strict";
import { parseMatchTypeFromReason } from "./routing-dry-run-admin.present.js";

test("parseMatchTypeFromReason extracts tier from match reason", () => {
  assert.equal(
    parseMatchTypeFromReason("Matched routing rule (campaign_id) → Agent A"),
    "campaign_id"
  );
  assert.equal(parseMatchTypeFromReason("No active routing rule matched"), null);
});
