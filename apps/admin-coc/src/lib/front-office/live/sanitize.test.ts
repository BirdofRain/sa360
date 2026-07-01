import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sanitizeTrustCard } from "./sanitize";
import type { TrustCheckCard } from "../types";

const sampleCard: TrustCheckCard = {
  key: "webhook_health",
  label: "Webhook Health",
  status: "warning",
  headline: "Bearer sk_live_secret token issue",
  lastCheckedAt: new Date().toISOString(),
  source: "live",
  checks: [
    {
      id: "1",
      label: "Validation",
      status: "warning",
      detail: "2 failures",
      source: "live",
      adminOnly: false,
      adminDetail: "raw payload: { token: abc123 }",
    },
    {
      id: "2",
      label: "Internal debug",
      status: "failed",
      detail: "Stack trace at handler",
      adminOnly: true,
      adminDetail: "Error: internal",
    },
  ],
};

describe("sanitizeTrustCard", () => {
  it("strips admin-only checks and redacts unsafe text for client role", () => {
    const sanitized = sanitizeTrustCard(sampleCard, "client");
    assert.equal(sanitized.checks.length, 1);
    assert.equal(sanitized.checks[0]?.label, "Validation");
    assert.ok(!sanitized.checks[0]?.adminDetail);
    assert.ok(!sanitized.headline.includes("sk_live"));
  });

  it("preserves admin detail for admin role with token redaction", () => {
    const sanitized = sanitizeTrustCard(sampleCard, "admin");
    assert.equal(sanitized.checks.length, 2);
    assert.ok(sanitized.checks[0]?.adminDetail?.includes("[redacted token]") || sanitized.checks[0]?.adminDetail?.includes("raw payload"));
  });
});
