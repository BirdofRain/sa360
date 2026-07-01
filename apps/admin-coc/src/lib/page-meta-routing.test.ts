import test from "node:test";
import assert from "node:assert/strict";
import { resolvePageMeta } from "./page-meta.ts";

test("resolvePageMeta returns Routing Dry Run for /routing-dry-run", () => {
  const meta = resolvePageMeta("/routing-dry-run");
  assert.equal(meta.title, "Routing Dry Run");
  assert.match(meta.description ?? "", /dry-run/i);
});

test("resolvePageMeta returns Lead Fulfillment Overview for /lead-fulfillment", () => {
  const meta = resolvePageMeta("/lead-fulfillment");
  assert.equal(meta.title, "Lead Fulfillment Overview");
  assert.match(meta.description ?? "", /LF1/i);
});

test("resolvePageMeta returns Pivot Archive for /planning/pivot-archive", () => {
  const meta = resolvePageMeta("/planning/pivot-archive");
  assert.equal(meta.title, "Pivot Archive");
  assert.match(meta.description ?? "", /historical/i);
});
