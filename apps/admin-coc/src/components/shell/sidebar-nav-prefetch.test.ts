import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("heavy Admin COC routes disable Next.js Link prefetch", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "sidebar-nav.tsx"), "utf8");
  assert.match(src, /prefetch=\{prefetch\}/);
  assert.match(src, /\/fulfillment-ops/);
  assert.match(src, /\/webhooks/);
  assert.match(src, /\/automation-dashboard/);
  assert.match(src, /HEAVY_ROUTE_HREFS/);
});
