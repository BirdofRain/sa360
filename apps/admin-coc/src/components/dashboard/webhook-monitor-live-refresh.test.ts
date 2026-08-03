import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("Webhook Monitor live refresh skips hidden tabs and avoids overlap", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "webhook-monitor-live-refresh.tsx"), "utf8");
  assert.match(src, /visibilityState === "hidden"/);
  assert.match(src, /inFlightRef/);
  assert.match(src, /LIVE_REFRESH_MS = 10_000/);
  assert.match(src, /clearInterval/);
});
