import test from "node:test";
import assert from "node:assert/strict";
import { buildMetaLeadgenFetchJobId } from "./meta-leadgen-fetch-queue.service.js";

test("buildMetaLeadgenFetchJobId is deterministic and colon-free", () => {
  const a = buildMetaLeadgenFetchJobId("1234567890");
  const b = buildMetaLeadgenFetchJobId(" 1234567890 ");
  assert.equal(a, "meta-leadgen-fetch-1234567890");
  assert.equal(a, b);
  assert.equal(a.includes(":"), false);
});

test("buildMetaLeadgenFetchJobId sanitizes unsafe characters", () => {
  const id = buildMetaLeadgenFetchJobId("lead/gen:id?");
  assert.equal(id, "meta-leadgen-fetch-lead_gen_id_");
  assert.equal(id.includes(":"), false);
  assert.equal(id.includes("/"), false);
});

test("buildMetaLeadgenFetchJobId rejects empty leadgen ids", () => {
  assert.throws(() => buildMetaLeadgenFetchJobId("   "), /leadgen_id_required/);
});
