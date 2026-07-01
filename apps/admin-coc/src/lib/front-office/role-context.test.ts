import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDevRole } from "./role-context";

describe("parseDevRole", () => {
  it("accepts valid dev roles", () => {
    assert.equal(parseDevRole("admin"), "admin");
    assert.equal(parseDevRole("client"), "client");
    assert.equal(parseDevRole("agent"), "agent");
  });

  it("rejects invalid roles", () => {
    assert.equal(parseDevRole("superuser"), null);
    assert.equal(parseDevRole(null), null);
    assert.equal(parseDevRole(""), null);
  });
});
