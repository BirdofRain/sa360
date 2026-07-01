import test from "node:test";
import assert from "node:assert/strict";
import { presentTrustCard } from "./front-office-trust-present.service.js";
import type { FrontOfficeTrustCard } from "./front-office.types.js";

test("client trust output redacts bearer tokens in adminDetail", () => {
  const card: FrontOfficeTrustCard = {
    key: "webhook_health",
    title: "Webhook Health",
    status: "warning",
    source: "live",
    summary: "Monitored",
    lastCheckedAt: null,
    warnings: ["Bearer sk_live_abc"],
    details: [
      {
        id: "1",
        label: "Failures",
        status: "warning",
        detail: "token=secret",
        adminOnly: true,
        adminDetail: "Bearer sk_live_abc",
      },
    ],
  };
  const presented = presentTrustCard(card, "client");
  assert.equal(presented.details.length, 0);
  assert.match(presented.warnings[0] ?? "", /contact your operator|Status available|\[redacted\]/);
  assert.ok(!JSON.stringify(presented).includes("sk_live_abc"));
});

test("admin trust output keeps redacted adminDetail", () => {
  const card: FrontOfficeTrustCard = {
    key: "ghl_connection",
    title: "GHL Connection",
    status: "verified",
    source: "live",
    summary: "Connected",
    lastCheckedAt: null,
    warnings: [],
    details: [
      {
        id: "1",
        label: "Loc",
        status: "verified",
        detail: "OK",
        adminDetail: "Bearer sk_test",
      },
    ],
  };
  const presented = presentTrustCard(card, "admin");
  assert.ok(presented.details[0]?.adminDetail?.includes("[redacted]"));
});
