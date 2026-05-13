import test from "node:test";
import assert from "node:assert/strict";
import { synthflowOutboundContextBodySchema } from "./synthflow-outbound-context.schema.js";

test("valid outbound context payload", () => {
  const parsed = synthflowOutboundContextBodySchema.safeParse({
    event: "call_outbound_context",
    call: {
      model_id: "mdl_1",
      from_number: "+15551230001",
      to_number: "+15559876543",
      client_account_id: "ca_test",
      subaccount_id_ghl: "loc_1",
    },
  });
  assert.equal(parsed.success, true);
});

test("invalid event rejects", () => {
  const parsed = synthflowOutboundContextBodySchema.safeParse({
    event: "call_inbound",
    call: { from_number: "+1", to_number: "+2" },
  });
  assert.equal(parsed.success, false);
});

test("missing lead phone rejects", () => {
  const parsed = synthflowOutboundContextBodySchema.safeParse({
    event: "call_outbound_context",
    call: { from_number: "+15551234567", to_number: "" },
  });
  assert.equal(parsed.success, false);
});

test("user_phone_number used when to_number empty", () => {
  const parsed = synthflowOutboundContextBodySchema.safeParse({
    event: "call_outbound_context",
    call: {
      from_number: "+15551230001",
      to_number: "",
      user_phone_number: "+15559876543",
    },
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.call.to_number, "+15559876543");
  }
});

test("placeholder phones strip then reject when none usable", () => {
  const parsed = synthflowOutboundContextBodySchema.safeParse({
    event: "call_outbound_context",
    call: {
      from_number: "+15551230001",
      to_number: "<to_number>",
      user_phone_number: "{{model_id}}",
    },
  });
  assert.equal(parsed.success, false);
});
