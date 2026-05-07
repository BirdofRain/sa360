import test from "node:test";
import assert from "node:assert/strict";
import { resolveOutboundContextCalendar } from "./synthflow-outbound-context-calendar-resolve.js";
import { resetOutboundCalendarMapCacheForTests } from "./synthflow-outbound-calendar-env.js";

test("resolveOutboundContextCalendar falls back to env map when routing empty", async () => {
  resetOutboundCalendarMapCacheForTests();
  const prev = process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
  process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = JSON.stringify({
    defaultByClientAccountId: {
      ca_env: { calendarId: "cal_env", calendarLink: "https://env.example" },
    },
  });
  try {
    const row = {
      id: "idx1",
      clientAccountId: "ca_env",
      subaccountIdGhl: "",
      phoneE164: "+15559876543",
      leadUid: "l1",
      contactIdGhl: null,
      firstName: null,
      lastName: null,
      displayName: null,
      email: null,
      state: null,
      assignedAgentId: null,
      assignedAgentName: null,
      lifecycleStage: null,
      appointmentStatus: null,
      policyStatus: null,
      leadType: null,
      sourceOrigin: "lifecycle_webhook" as const,
      clientStatus: null,
      lastSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const r = await resolveOutboundContextCalendar(row);
    assert.equal(r.calendarSource, "client_default");
    assert.equal(r.schedulingCalendarId, "cal_env");
    assert.equal(r.schedulingCalendarLink, "https://env.example");
    assert.equal(r.newBookingCalendarReady, true);
  } finally {
    if (prev === undefined) delete process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
    else process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = prev;
    resetOutboundCalendarMapCacheForTests();
  }
});
