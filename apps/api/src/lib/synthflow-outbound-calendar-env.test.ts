import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveOutboundCalendarEntry,
  resetOutboundCalendarMapCacheForTests,
} from "./synthflow-outbound-calendar-env.js";

test("calendar resolution prefers agent over client default", () => {
  resetOutboundCalendarMapCacheForTests();
  const prev = process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
  process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = JSON.stringify({
    byAgentId: { agent_a: { calendarId: "cal_agent", calendarLink: "https://example.com/a" } },
    defaultByClientAccountId: {
      ca_1: { calendarId: "cal_default", calendarLink: "https://example.com/d" },
    },
  });
  try {
    const r = resolveOutboundCalendarEntry({
      clientAccountId: "ca_1",
      assignedAgentId: "agent_a",
    });
    assert.equal(r.source, "agent");
    assert.equal(r.entry?.calendarId, "cal_agent");
  } finally {
    resetOutboundCalendarMapCacheForTests();
    if (prev === undefined) {
      delete process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
    } else {
      process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = prev;
    }
  }
});

test("calendar resolution falls back to client default", () => {
  resetOutboundCalendarMapCacheForTests();
  const prev = process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
  process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = JSON.stringify({
    defaultByClientAccountId: {
      ca_1: { calendarId: "cal_default" },
    },
  });
  try {
    const r = resolveOutboundCalendarEntry({
      clientAccountId: "ca_1",
      assignedAgentId: "unknown",
    });
    assert.equal(r.source, "client_default");
    assert.equal(r.entry?.calendarId, "cal_default");
  } finally {
    resetOutboundCalendarMapCacheForTests();
    if (prev === undefined) {
      delete process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
    } else {
      process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = prev;
    }
  }
});
