import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canAccessRoute, filterNavByRole } from "./nav";

describe("front-office nav ACL", () => {
  it("admin sees all nav items", () => {
    assert.equal(filterNavByRole("admin").length, 5);
  });

  it("client cannot access dial desk", () => {
    assert.equal(canAccessRoute("client", "/front-office/dial-desk"), false);
    assert.equal(canAccessRoute("client", "/front-office/orders"), true);
  });

  it("agent cannot access orders or trust", () => {
    assert.equal(canAccessRoute("agent", "/front-office/orders"), false);
    assert.equal(canAccessRoute("agent", "/front-office/trust"), false);
    assert.equal(canAccessRoute("agent", "/front-office/dial-desk"), true);
  });

  it("agent sees fewer nav items than admin", () => {
    assert.ok(filterNavByRole("agent").length < filterNavByRole("admin").length);
  });
});
