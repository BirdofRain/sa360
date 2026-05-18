import test from "node:test";
import assert from "node:assert/strict";
import { WHAT_HAPPENED_BUTTONS, actionRequiresForm } from "./what-happened.ts";

test("maps UI labels to action codes", () => {
  const labels = Object.fromEntries(
    WHAT_HAPPENED_BUTTONS.map((b) => [b.label, b.actionCode])
  );
  assert.equal(labels["Call Attempt"], "CALL_ATTEMPT");
  assert.equal(labels["Connected"], "CALL_CONNECTED");
  assert.equal(labels["No Answer"], "NO_ANSWER");
  assert.equal(labels["Booked"], "BOOKED");
  assert.equal(labels["Follow Up"], "FOLLOW_UP");
  assert.equal(labels["Quote Given"], "QUOTE_GIVEN");
  assert.equal(labels["Sold"], "SOLD");
  assert.equal(labels["Not Interested"], "NOT_INTERESTED");
  assert.equal(labels["Bad Number"], "BAD_NUMBER");
  assert.equal(labels["DNC"], "DNC");
  assert.equal(labels["Dead Lead"], "DEAD_LEAD");
});

test("requires form for high-impact and follow-up", () => {
  assert.equal(actionRequiresForm("SOLD"), true);
  assert.equal(actionRequiresForm("DNC"), true);
  assert.equal(actionRequiresForm("FOLLOW_UP"), true);
  assert.equal(actionRequiresForm("CALL_ATTEMPT"), false);
});
