import test from "node:test";
import assert from "node:assert/strict";
import {
  guidanceResourceScopeWhere,
  playbookScopeWhere,
} from "./agent-workspace.service.js";

test("guidanceResourceScopeWhere: global + client OR, active only", () => {
  const w = guidanceResourceScopeWhere("ca_test");
  assert.equal(w.isActive, true);
  assert.ok(Array.isArray(w.OR));
  assert.deepEqual(w.OR, [{ clientAccountId: null }, { clientAccountId: "ca_test" }]);
  assert.equal(w.AND, undefined);
});

test("guidanceResourceScopeWhere: nicheKey adds OR(null,empty,match) with insensitive mode", () => {
  const w = guidanceResourceScopeWhere("ca_test", "fex");
  assert.ok(w.AND);
  const and = w.AND as { OR?: unknown[] }[];
  assert.equal(and.length, 1);
  const nicheOr = (and[0] as { OR: unknown[] }).OR;
  assert.equal(nicheOr.length, 3);
  assert.deepEqual(nicheOr[0], { nicheKey: null });
  assert.deepEqual(nicheOr[1], { nicheKey: "" });
  assert.deepEqual(nicheOr[2], { nicheKey: { equals: "fex", mode: "insensitive" } });
});

test("guidanceResourceScopeWhere: lifecycleStage adds OR(null,empty,match)", () => {
  const w = guidanceResourceScopeWhere("ca_test", undefined, "NEW_LEAD");
  assert.ok(w.AND);
  const and = w.AND as { OR?: unknown[] }[];
  assert.equal(and.length, 1);
  const lsOr = (and[0] as { OR: unknown[] }).OR;
  assert.deepEqual(lsOr[2], { lifecycleStage: { equals: "NEW_LEAD", mode: "insensitive" } });
});

test("guidanceResourceScopeWhere: niche + lifecycle both constrain AND", () => {
  const w = guidanceResourceScopeWhere("ca_test", "MTG", "quoted");
  const and = w.AND as { OR: unknown[] }[];
  assert.equal(and.length, 2);
});

test("playbookScopeWhere: global + client OR without niche", () => {
  const w = playbookScopeWhere("ca_test");
  assert.equal(w.isActive, true);
  assert.deepEqual(w.OR, [{ clientAccountId: null }, { clientAccountId: "ca_test" }]);
  assert.equal(w.AND, undefined);
});

test("playbookScopeWhere: nicheKey filters like guidance resources", () => {
  const w = playbookScopeWhere("ca_x", "vet");
  const and = w.AND as { OR: unknown[] }[];
  assert.equal(and.length, 1);
  const nk = (and[0] as { OR: unknown[] }).OR[2];
  assert.deepEqual(nk, { nicheKey: { equals: "vet", mode: "insensitive" } });
});
