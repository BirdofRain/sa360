import test from "node:test";
import assert from "node:assert/strict";
import {
  computeOutboundRescheduleAllowed,
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

test("resolveOutboundGuardrails: unknown contact → no_scheduling_source", () => {
  const r = resolveOutboundGuardrails({
    contactFound: false,
    precallBookingEligible: false,
    hasActiveAppointment: false,
    calendarIdPresent: true,
    newBookingCalendarReady: true,
    assignedAgentId: "a1",
    doNotCallSignal: false,
    routingCalendarComplete: false,
  });
  assert.equal(r.scriptGoal, "REVIEW_REQUIRED");
  assert.equal(r.bookingAllowed, false);
  assert.equal(r.doNotBookReason, "no_scheduling_source");
});

test("resolveOutboundGuardrails: precall kit → ATTEMPT_TO_BOOK", () => {
  const r = resolveOutboundGuardrails({
    contactFound: false,
    precallBookingEligible: true,
    hasActiveAppointment: false,
    calendarIdPresent: false,
    newBookingCalendarReady: false,
    assignedAgentId: "",
    doNotCallSignal: false,
    routingCalendarComplete: false,
  });
  assert.equal(r.scriptGoal, "ATTEMPT_TO_BOOK");
  assert.equal(r.bookingAllowed, true);
  assert.equal(r.doNotBookReason, "");
});

test("resolveOutboundGuardrails: booked → CONFIRM + no booking", () => {
  const r = resolveOutboundGuardrails({
    contactFound: true,
    precallBookingEligible: false,
    hasActiveAppointment: true,
    calendarIdPresent: true,
    newBookingCalendarReady: true,
    assignedAgentId: "a1",
    doNotCallSignal: false,
    routingCalendarComplete: false,
  });
  assert.equal(r.scriptGoal, "CONFIRM_EXISTING_APPOINTMENT");
  assert.equal(r.bookingAllowed, false);
});

test("resolveOutboundGuardrails: bookable path", () => {
  const r = resolveOutboundGuardrails({
    contactFound: true,
    precallBookingEligible: false,
    hasActiveAppointment: false,
    calendarIdPresent: true,
    newBookingCalendarReady: true,
    assignedAgentId: "agent_x",
    doNotCallSignal: false,
    routingCalendarComplete: false,
  });
  assert.equal(r.scriptGoal, "BOOK_APPOINTMENT");
  assert.equal(r.bookingAllowed, true);
  assert.equal(r.doNotBookReason, "");
});

test("resolveOutboundGuardrails: missing calendar", () => {
  const r = resolveOutboundGuardrails({
    contactFound: true,
    precallBookingEligible: false,
    hasActiveAppointment: false,
    calendarIdPresent: false,
    newBookingCalendarReady: false,
    assignedAgentId: "a1",
    doNotCallSignal: false,
    routingCalendarComplete: false,
  });
  assert.equal(r.scriptGoal, "REVIEW_REQUIRED");
  assert.equal(r.bookingAllowed, false);
  assert.equal(r.doNotBookReason, "missing_calendar");
});

test("resolveOutboundGuardrails: routing id without link → missing_calendar_link", () => {
  const r = resolveOutboundGuardrails({
    contactFound: true,
    precallBookingEligible: false,
    hasActiveAppointment: false,
    calendarIdPresent: true,
    newBookingCalendarReady: false,
    assignedAgentId: "a1",
    doNotCallSignal: false,
    routingCalendarComplete: false,
  });
  assert.equal(r.scriptGoal, "REVIEW_REQUIRED");
  assert.equal(r.doNotBookReason, "missing_calendar_link");
});

test("resolveOutboundGuardrails: missing agent id", () => {
  const r = resolveOutboundGuardrails({
    contactFound: true,
    precallBookingEligible: false,
    hasActiveAppointment: false,
    calendarIdPresent: true,
    newBookingCalendarReady: true,
    assignedAgentId: "",
    doNotCallSignal: false,
    routingCalendarComplete: false,
  });
  assert.equal(r.scriptGoal, "REVIEW_REQUIRED");
  assert.equal(r.doNotBookReason, "missing_assigned_agent");
});

test("resolveOutboundGuardrails: routing calendar complete bypasses agent", () => {
  const r = resolveOutboundGuardrails({
    contactFound: true,
    precallBookingEligible: false,
    hasActiveAppointment: false,
    calendarIdPresent: true,
    newBookingCalendarReady: true,
    assignedAgentId: "",
    doNotCallSignal: false,
    routingCalendarComplete: true,
  });
  assert.equal(r.scriptGoal, "BOOK_APPOINTMENT");
  assert.equal(r.bookingAllowed, true);
});

test("resolveOutboundGuardrails: DNC lifecycle → DO_NOT_CALL", () => {
  const r = resolveOutboundGuardrails({
    contactFound: true,
    precallBookingEligible: false,
    hasActiveAppointment: false,
    calendarIdPresent: true,
    newBookingCalendarReady: true,
    assignedAgentId: "a1",
    doNotCallSignal: true,
    routingCalendarComplete: false,
  });
  assert.equal(r.scriptGoal, "DO_NOT_CALL");
});

test("lifecycle helpers detect DNC / bad number", () => {
  assert.equal(outboundLifecycleDoNotCall("Do Not Contact"), true);
  assert.equal(outboundLifecycleBadNumber("BAD_NUMBER"), true);
});

test("computeOutboundRescheduleAllowed: true when booked + calendar + known", () => {
  assert.equal(
    computeOutboundRescheduleAllowed({
      contactFound: true,
      hasActiveAppointment: true,
      schedulingCalendarLink: "https://book.example",
      doNotCallSignal: false,
    }),
    true
  );
});

test("computeOutboundRescheduleAllowed: false without calendar link or appointment", () => {
  assert.equal(
    computeOutboundRescheduleAllowed({
      contactFound: true,
      hasActiveAppointment: true,
      schedulingCalendarLink: "",
      doNotCallSignal: false,
    }),
    false
  );
  assert.equal(
    computeOutboundRescheduleAllowed({
      contactFound: true,
      hasActiveAppointment: false,
      schedulingCalendarLink: "https://book.example",
      doNotCallSignal: false,
    }),
    false
  );
});
