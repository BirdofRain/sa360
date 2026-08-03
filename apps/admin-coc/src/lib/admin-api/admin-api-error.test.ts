import assert from "node:assert/strict";
import { test } from "node:test";

import { formatAdminApiError } from "./admin-api-error.ts";

test("formatAdminApiError never surfaces raw HTML gateway bodies", () => {
  const msg = formatAdminApiError({
    ok: false,
    status: 504,
    body: "<!DOCTYPE html><html><body>Gateway Timeout</body></html>",
  });
  assert.match(msg, /temporarily unavailable/i);
  assert.doesNotMatch(msg, /<!DOCTYPE/i);
  assert.doesNotMatch(msg, /<html/i);
});

test("formatAdminApiError handles 502/503 without leaking HTML", () => {
  for (const status of [502, 503]) {
    const msg = formatAdminApiError({
      ok: false,
      status,
      body: "<html>bad gateway</html>",
    });
    assert.match(msg, new RegExp(`HTTP ${status}`));
    assert.doesNotMatch(msg, /<html/i);
  }
});
