import assert from "node:assert/strict";
import test from "node:test";

import { formatDiagnosticTimestamp } from "./diagnostic-timestamp.ts";

test("diagnostic timestamps keep authoritative UTC and label the zone", () => {
  const formatted = formatDiagnosticTimestamp("2026-08-18T16:00:00.000Z");
  assert.equal(formatted.utc, "2026-08-18T16:00:00.000Z");
  assert.match(formatted.display, /UTC/);
  assert.match(formatted.display, /2026/);
});
