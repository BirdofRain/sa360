import assert from "node:assert/strict";
import test from "node:test";
import { planningNav } from "./nav.ts";

test("planning nav includes pivot archive route", () => {
  const item = planningNav.find((n) => n.href === "/planning/pivot-archive");
  assert.ok(item);
  assert.equal(item?.label, "Pivot Archive");
});
