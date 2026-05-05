import test from "node:test";
import assert from "node:assert/strict";
import {
  outboundHasActiveAppointment,
  outboundLifecycleBadNumber,
  outboundLifecycleDoNotCall,
  resolveOutboundGuardrails,
} from "./synthflow-outbound-context.logic.js";

test("has_active_appointment: lifecycle APPOINTMENT_SET", () => {
  assert.equal(
    outboundHasActiveAppointment({
      appointmentStatus: "",
      lifecycleStage: "appointment_set",
    }),
    true
  );
});

test("has_active_appointment: exact SET / CONFIRMED / APPOINTMENT_SET only", () => {
  assert.equal(
    outboundHasActiveAppointment({ appointmentStatus: "SET", lifecycleStage: "" }),
    true
  );
  assert.equal(
    outboundHasActiveAppointment({ appointmentStatus: "NOT_SET", lifecycleStage: "" }),
    false
  );
  assert.equal(
    outboundHasActiveAppointment({ appointmentStatus: "CONFIRMED", lifecycleStage: "" }),
    true
  );
});

test("resolveOutboundGuardrails: unknown contact → REVIEW_REQUIRED", () => {
  const r = resolveOutboundGuardrails({
    contactFound: false,
    hasActiveAppointment: false,
    calendarPresent: true,
    assignedAgentId: "a1",
    doNotCallSignal: false,
  });
  assert.equal(r.scriptGoal, "REVIEW_REQUIRED");
  assert.equal(r.bookingAllowed, false);
  assert.equal(r.doNotBookReason, "contact_unknown");
});

test("resolveOutboundGuardrails: booked → CONFIRM + no booking", () => {
  const r = resolveOutboundGuardrails({
    contactFound: true,
    hasActiveAppointment: true,
    calendarPresent: true,
    assignedAgentId: "a1",
    doNotCallSignal: false,
  });
  assert.equal(r.scriptGoal, "CONFIRM_EXISTING_APPOINTMENT");
  assert.equal(r.bookingAllowed, false);
});

test("resolveOutboundGuardrails: bookable path", () => {
  const r = resolveOutboundGuardrails({
    contactFound: true,
    hasActiveAppointment: false,
    calendarPresent: true,
    assignedAgentId: "agent_x",
    doNotCallSignal: false,
  });
  assert.equal(r.scriptGoal, "BOOK_APPOINTMENT");
  assert.equal(r.bookingAllowed, true);
  assert.equal(r.doNotBookReason, "");
});

test("resolveOutboundGuardrails: missing calendar", () => {
  const r = resolveOutboundGuardrails({
    contactFound: true,
    hasActiveAppointment: false,
    calendarPresent: false,
    assignedAgentId: "a1",
    doNotCallSignal: false,
  });
  assert.equal(r.scriptGoal, "REVIEW_REQUIRED");
  assert.equal(r.bookingAllowed, false);
  assert.equal(r.doNotBookReason, "missing_calendar");
});

test("resolveOutboundGuardrails: missing agent id", () => {
  const r = resolveOutboundGuardrails({
    contactFound: true,
    hasActiveAppointment: false,
    calendarPresent: true,
    assignedAgentId: "",
    doNotCallSignal: false,
  });
  assert.equal(r.scriptGoal, "REVIEW_REQUIRED");
  assert.equal(r.doNotBookReason, "missing_assigned_agent");
});

test("resolveOutboundGuardrails: DNC lifecycle → DO_NOT_CALL", () => {
  const r = resolveOutboundGuardrails({
    contactFound: true,
    hasActiveAppointment: false,
    calendarPresent: true,
    assignedAgentId: "a1",
    doNotCallSignal: true,
  });
  assert.equal(r.scriptGoal, "DO_NOT_CALL");
});

test("lifecycle helpers detect DNC / bad number", () => {
  assert.equal(outboundLifecycleDoNotCall("Do Not Contact"), true);
  assert.equal(outboundLifecycleBadNumber("BAD_NUMBER"), true);
});
