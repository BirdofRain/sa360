import assert from "node:assert/strict";
import test from "node:test";

import { isObserverAdminApiGetAllowed } from "../admin-coc-observer-access.ts";
import { parseOnboardingAttribution } from "./onboarding-attribution.ts";

const REQUEST_ID = "6f1e2d3c-4b5a-4678-89ab-cdef01234567";

test("attribution readback requires the stored actor and ids", () => {
  const stored = {
    ok: true,
    clientAccountId: "acceptance_client",
    recordType: "setup_audit",
    recordId: "audit_1",
    requestId: REQUEST_ID,
    actor: "ADMIN",
    saved: true,
  };
  assert.deepEqual(parseOnboardingAttribution(stored, REQUEST_ID), {
    recordType: "setup_audit",
    recordId: "audit_1",
    requestId: REQUEST_ID,
    actor: "ADMIN",
  });
  assert.equal(
    parseOnboardingAttribution({ ...stored, actor: "c0123456789abcdefghijklmn", recordType: "source_campaign_request" }, REQUEST_ID)
      ?.actor,
    "c0123456789abcdefghijklmn"
  );
  assert.equal(parseOnboardingAttribution({ ok: true, message: "Saved" }, REQUEST_ID), null);
  assert.equal(parseOnboardingAttribution({ ...stored, actor: " ADMIN" }, REQUEST_ID), null);
  assert.equal(parseOnboardingAttribution({ ...stored, requestId: "other" }, REQUEST_ID), null);
  assert.equal(parseOnboardingAttribution({ ...stored, ok: false }, REQUEST_ID), null);
});

test("observers and the customer portal are not given the attribution path", () => {
  assert.equal(
    isObserverAdminApiGetAllowed(`/admin/v1/clients/acceptance_client/onboarding-attribution/${REQUEST_ID}`),
    false
  );
  assert.equal(isObserverAdminApiGetAllowed("/portal/acceptance_client"), false);
});
