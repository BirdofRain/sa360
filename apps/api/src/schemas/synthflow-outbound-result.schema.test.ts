import test from "node:test";
import assert from "node:assert/strict";
import { synthflowOutboundResultBodySchema } from "./synthflow-outbound-result.schema.js";

test("valid outbound result payload", () => {
  const parsed = synthflowOutboundResultBodySchema.safeParse({
    event: "call_outbound_result",
    call_result: {
      call_id: "call_123",
      model_id: "mdl_1",
      from_number: "+15551230001",
      to_number: "+15559876543",
      contact_id_ghl: "ctc_1",
      client_account_id: "ca_1",
      subaccount_id_ghl: "loc_1",
      outcome: "booked",
      booked: true,
      appointment_time: "2026-05-10T15:00:00.000Z",
      transcript_summary: "Agent booked follow-up.",
    },
  });
  assert.equal(parsed.success, true);
});

test("invalid outcome rejects", () => {
  const parsed = synthflowOutboundResultBodySchema.safeParse({
    event: "call_outbound_result",
    call_result: {
      call_id: "c1",
      from_number: "+1",
      to_number: "+2",
      outcome: "unknown_outcome",
    },
  });
  assert.equal(parsed.success, false);
});
