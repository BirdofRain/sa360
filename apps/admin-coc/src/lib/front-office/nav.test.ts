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

  it("inventory explorer nav is admin and client only (hidden for agent)", () => {
    assert.equal(canAccessRoute("admin", "/front-office/pipeline-studio"), true);
    assert.equal(canAccessRoute("client", "/front-office/pipeline-studio"), true);
    assert.equal(canAccessRoute("agent", "/front-office/pipeline-studio"), false);
    const adminItem = filterNavByRole("admin").find(
      (i) => i.href === "/front-office/pipeline-studio"
    );
    const clientItem = filterNavByRole("client").find(
      (i) => i.href === "/front-office/pipeline-studio"
    );
    assert.ok(adminItem);
    assert.ok(clientItem);
    assert.equal(adminItem!.label, "Inventory Explorer");
    assert.equal(clientItem!.label, "Inventory Explorer");
    assert.ok(
      !filterNavByRole("agent").some((i) => i.href === "/front-office/pipeline-studio")
    );
  });

  it("agent sees fewer nav items than admin", () => {
    assert.ok(filterNavByRole("agent").length < filterNavByRole("admin").length);
  });
});
