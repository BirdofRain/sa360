import test from "node:test";
import assert from "node:assert/strict";

import { isLeadCaptureTrustReconcileJobEnabled } from "./leadcapture-trust-reconcile.job.js";

test("LeadCapture trust reconcile job remains disabled by default", () => {
  assert.equal(isLeadCaptureTrustReconcileJobEnabled(), false);
});
