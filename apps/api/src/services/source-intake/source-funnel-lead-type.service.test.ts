import assert from "node:assert/strict";
import test from "node:test";

import {
  configureSourceFunnelLeadType,
  isSourceFunnelLeadTypeError,
} from "./source-funnel-lead-type.service.js";

test("Lead Type configuration rejects an actor that is not admin or a staff principal", async () => {
  await assert.rejects(
    () =>
      configureSourceFunnelLeadType({
        sourceFunnelId: "sf_ray",
        leadTypeKey: "vet_web_form",
        actor: "ray@example.com",
      }),
    (err: unknown) => {
      assert.equal(isSourceFunnelLeadTypeError(err), true);
      if (!isSourceFunnelLeadTypeError(err)) return false;
      assert.equal(err.code, "actor_rejected");
      return true;
    }
  );
});
