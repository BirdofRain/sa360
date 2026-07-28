import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeAgentName } from "./agent-name-normalize.js";

test("normalizeAgentName applies NFKC, casing, whitespace, and punctuation rules", () => {
  assert.equal(normalizeAgentName("  Jane   O'Connor  "), "jane o connor");
  assert.equal(normalizeAgentName("Agent—Smith"), "agent smith");
  assert.equal(normalizeAgentName("  "), "");
});

test("normalizeAgentName is idempotent", () => {
  const once = normalizeAgentName("Dr.  Alex  Lee, Jr.");
  const twice = normalizeAgentName(once);
  assert.equal(once, twice);
});
