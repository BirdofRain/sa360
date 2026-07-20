import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canAccessRoute, filterNavByRole } from "./nav";

describe("front-office nav ACL", () => {
  it("admin sees all nav items", () => {
    assert.equal(filterNavByRole("admin").length, 7);
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

  it("pipeline studio is admin and client only", () => {
    assert.equal(canAccessRoute("admin", "/front-office/pipeline-studio"), true);
    assert.equal(canAccessRoute("client", "/front-office/pipeline-studio"), true);
    assert.equal(canAccessRoute("agent", "/front-office/pipeline-studio"), false);
    assert.ok(
      filterNavByRole("admin").some((i) => i.href === "/front-office/pipeline-studio")
    );
    assert.ok(
      filterNavByRole("client").some((i) => i.href === "/front-office/pipeline-studio")
    );
    assert.ok(
      !filterNavByRole("agent").some((i) => i.href === "/front-office/pipeline-studio")
    );
  });

  it("agent sees fewer nav items than admin", () => {
    assert.ok(filterNavByRole("agent").length < filterNavByRole("admin").length);
  });
});
