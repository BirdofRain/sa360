import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeMetaCaptureHealth } from "./meta-capture-health.ts";

test("capture health drops a credential that still carries a token", () => {
  const view = sanitizeMetaCaptureHealth({
    flags: {
      intakeEnabled: false,
      graphFetchEnabled: false,
      routingEnabled: false,
      captureAssociationEnabled: true,
      unboundPageTokenEnabled: false,
      inventoryDiscoveryEnabled: false,
      encryptionConfigured: true,
      envTokenConfigured: true,
      envTokenPageId: "102720336121632",
    },
    review: { adminReviewUnmatched: 2, associationDisabled: 0, captureNotAllowlisted: 1, candidateForms: 22 },
    credentials: [
      {
        id: "cred_leak",
        kind: "page_access_token",
        status: "active",
        tokenFingerprint: "abc",
        accessToken: "EAAB-browser-must-not-see-this",
        pages: [{ pageId: "102720336121632", pageName: "Pilot", captureEnabled: false }],
      },
      {
        id: "cred_ok",
        kind: "system_user",
        status: "active",
        tokenFingerprint: "def456",
        expiresAt: null,
        scopes: ["leads_retrieval"],
        lastDiagnostic: "missing leads_retrieval",
        pages: [{ pageId: "102720336121633", pageName: null, captureEnabled: true }],
      },
    ],
  });
  assert.ok(view);
  assert.equal(JSON.stringify(view).includes("EAAB-browser-must-not-see-this"), false);
  assert.equal(view?.pages.length, 1);
  assert.equal(view?.pages[0]?.tokenFingerprint, "def456");
  assert.equal(view?.pages[0]?.captureEnabled, true);
  assert.equal(view?.review.adminReviewUnmatched, 2);
  assert.equal(view?.flags.routingEnabled, false);
});
