import assert from "node:assert/strict";
import { test } from "node:test";

import { FacebookCaptureIntakeDisabledError, isFacebookCaptureIntakeEnabled } from "./facebook-capture-gate.js";
import { appendAssociationAudit } from "./facebook-capture-reevaluate.service.js";
import { confirmFacebookFormAssociation } from "./facebook-form-association.service.js";
import { processZapierFacebookCapture } from "./zapier-facebook-capture.service.js";
import { reevaluateFacebookCaptureAssociation } from "./facebook-capture-reevaluate.service.js";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("association audit appends without dropping older entries", () => {
  const existing = Array.from({ length: 50 }, (_, index) => ({ n: index }));
  const next = appendAssociationAudit(existing, { n: 50, action: "reevaluate_association" });
  assert.equal(next.length, 51);
  assert.equal((next[0] as { n: number }).n, 0);
  assert.equal((next[50] as { n: number }).n, 50);
});

test("capture and association writes stay off unless the gate is exactly true", async () => {
  const previous = process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED;
  try {
    delete process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED;
    assert.equal(isFacebookCaptureIntakeEnabled(), false);
    process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED = "false";
    assert.equal(isFacebookCaptureIntakeEnabled(), false);
    process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED = "TRUE";
    assert.equal(isFacebookCaptureIntakeEnabled(), true);
    delete process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED;
    await assert.rejects(
      () => processZapierFacebookCapture({ rawPayload: { leadgen_id: "900000000000001" } }),
      (error: unknown) => error instanceof FacebookCaptureIntakeDisabledError
    );
    await assert.rejects(
      () =>
        confirmFacebookFormAssociation({
          pageId: "900000000000101",
          formId: "900000000000201",
          clientAccountId: "client_a",
        }),
      (error: unknown) => error instanceof FacebookCaptureIntakeDisabledError
    );
    await assert.rejects(
      () => reevaluateFacebookCaptureAssociation({ sourceEventId: "evt_missing" }),
      (error: unknown) => error instanceof FacebookCaptureIntakeDisabledError
    );
  } finally {
    restoreEnv("SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED", previous);
  }
});
