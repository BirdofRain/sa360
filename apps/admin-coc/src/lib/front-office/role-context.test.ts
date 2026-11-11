import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDevRole, resolveFrontOfficeSession } from "./role-context.ts";

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

describe("staff admin front office session", () => {
  it("accepts a granted staff admin and rejects an unprivileged staff session", async () => {
    const admin = await resolveFrontOfficeSession(null, {
      staffToken: "staff-session",
      staffDecision: async () => "admin",
    });
    assert.equal(admin?.role, "admin");
    assert.equal(admin?.isDevPreview, false);

    const limited = await resolveFrontOfficeSession(null, {
      staffToken: "staff-session",
      staffDecision: async () => "limited",
    });
    assert.equal(limited, null);

    const revoked = await resolveFrontOfficeSession(null, {
      staffToken: "copied-session",
      staffDecision: async () => "anonymous",
    });
    assert.equal(revoked, null);
  });
});
