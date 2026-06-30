import assert from "node:assert/strict";
import test from "node:test";

import { persistLeadProofFromPayload } from "./lead-proof-ingest.service.js";

test("persistLeadProofFromPayload returns structured error for invalid payload without throw", async () => {
  const result = await persistLeadProofFromPayload(null);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errorCode, "INVALID_PAYLOAD");
});

test("persistLeadProofFromPayload returns missing leadUid error without throw", async () => {
  const result = await persistLeadProofFromPayload({
    attribution: { source_platform: "facebook", source_type: "facebook_lead_form" },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errorCode, "MISSING_LEAD_UID");
});
