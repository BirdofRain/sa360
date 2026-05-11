import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveOutboundContextCalendar,
} from "./synthflow-outbound-context-calendar-resolve.js";
import { resetOutboundCalendarMapCacheForTests } from "./synthflow-outbound-calendar-env.js";
import {
  computeOutboundRescheduleAllowed,
  resolveOutboundGuardrails,
} from "./synthflow-outbound-context.logic.js";

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

const mockRow = {
  id: "idx1",
  clientAccountId: "ca1",
  subaccountIdGhl: "",
  phoneE164: "+15559876543",
  leadUid: "l1",
  contactIdGhl: "ct_ghl_1",
  firstName: null,
  lastName: null,
  displayName: null,
  email: null,
  state: null,
  assignedAgentId: "user_agent_1",
  assignedAgentName: "Agent",
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

test("lifecycle routing calendar_id + calendar_link → full routing resolution + BOOK_APPOINTMENT guardrails", async () => {
  const cal = await resolveOutboundContextCalendar(null, {
    lifecyclePayload: {
      routing: {
        niche_key: "vet",
        calendar_id: "2g304CS2O8Mb1kUuVwOw",
        calendar_link: "https://api.leadconnectorhq.com/widget/booking/2g304CS2O8Mb1kUuVwOw",
      },
    },
  });
  assert.equal(cal.calendarSource, "routing");
  assert.equal(cal.schedulingCalendarId, "2g304CS2O8Mb1kUuVwOw");
  assert.ok(cal.schedulingCalendarLink.includes("booking"));
  assert.equal(cal.newBookingCalendarReady, true);
  assert.equal(cal.routingCalendarComplete, true);

  const guard = resolveOutboundGuardrails({
    contactFound: true,
    hasActiveAppointment: false,
    calendarIdPresent: cal.calendarIdPresent,
    newBookingCalendarReady: cal.newBookingCalendarReady,
    assignedAgentId: "user_agent_1",
    doNotCallSignal: false,
    routingCalendarComplete: cal.routingCalendarComplete,
  });
  assert.equal(guard.scriptGoal, "BOOK_APPOINTMENT");
  assert.equal(guard.bookingAllowed, true);
  assert.equal(guard.doNotBookReason, "");
});

test("routing sa360_* aliases when primary fields empty", async () => {
  const cal = await resolveOutboundContextCalendar(null, {
    lifecyclePayload: {
      routing: {
        sa360_calendar_id: "cal_from_alias",
        sa360_calendar_link: "https://book.example/alias",
      },
    },
  });
  assert.equal(cal.calendarSource, "routing");
  assert.equal(cal.schedulingCalendarId, "cal_from_alias");
  assert.equal(cal.schedulingCalendarLink, "https://book.example/alias");
  assert.equal(cal.newBookingCalendarReady, true);
});

test("unresolved GHL template strings in routing → empty extract → env map fallback", async () => {
  resetOutboundCalendarMapCacheForTests();
  const prev = process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
  process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = JSON.stringify({
    defaultByClientAccountId: {
      ca1: { calendarId: "env_cal", calendarLink: "https://env.fallback" },
    },
  });
  try {
    const cal = await resolveOutboundContextCalendar(mockRow, {
      lifecyclePayload: {
        routing: {
          calendar_id: "{{contact.sa360_calendar_id}}",
          calendar_link: "{{contact.sa360_calendar_link}}",
        },
      },
    });
    assert.equal(cal.calendarSource, "client_default");
    assert.equal(cal.schedulingCalendarId, "env_cal");
    assert.equal(cal.schedulingCalendarLink, "https://env.fallback");
  } finally {
    if (prev === undefined) delete process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
    else process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = prev;
    resetOutboundCalendarMapCacheForTests();
  }
});

test("active appointment + routing link → CONFIRM + reschedule_allowed with link", async () => {
  const cal = await resolveOutboundContextCalendar(null, {
    lifecyclePayload: {
      routing: {
        calendar_id: "cal1",
        calendar_link: "https://reschedule.example",
      },
    },
  });
  const guard = resolveOutboundGuardrails({
    contactFound: true,
    hasActiveAppointment: true,
    calendarIdPresent: true,
    newBookingCalendarReady: true,
    assignedAgentId: "a1",
    doNotCallSignal: false,
    routingCalendarComplete: true,
  });
  assert.equal(guard.scriptGoal, "CONFIRM_EXISTING_APPOINTMENT");
  assert.equal(guard.bookingAllowed, false);
  assert.equal(
    computeOutboundRescheduleAllowed({
      contactFound: true,
      hasActiveAppointment: true,
      schedulingCalendarLink: cal.schedulingCalendarLink,
      doNotCallSignal: false,
    }),
    true
  );
});

const rowNoContactId = {
  ...mockRow,
  contactIdGhl: null,
};

test("webhook request body resolves BOOK_APPOINTMENT when lifecycle routing has no calendar", async () => {
  const cal = await resolveOutboundContextCalendar(rowNoContactId, {
    lifecyclePayload: {
      routing: { niche_key: "vet" },
    },
    webhookRequestBody: {
      routing: {
        calendar_id: "2g304CS2O8Mb1kUuVwOw",
        calendar_link: "https://api.leadconnectorhq.com/widget/booking/2g304CS2O8Mb1kUuVwOw",
      },
    },
  });
  assert.equal(cal.calendarSource, "webhook_request");
  assert.equal(cal.newBookingCalendarReady, true);
  assert.equal(cal.routingCalendarComplete, true);

  const guard = resolveOutboundGuardrails({
    contactFound: true,
    hasActiveAppointment: false,
    calendarIdPresent: cal.calendarIdPresent,
    newBookingCalendarReady: cal.newBookingCalendarReady,
    assignedAgentId: "user_agent_1",
    doNotCallSignal: false,
    routingCalendarComplete: cal.routingCalendarComplete,
  });
  assert.equal(guard.scriptGoal, "BOOK_APPOINTMENT");
});

test("webhook DB fallback requires contactIdGhl on row (no cross-contact webhook match)", async () => {
  resetOutboundCalendarMapCacheForTests();
  const prev = process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
  process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = "";
  try {
    const rowMissingContact = { ...mockRow, contactIdGhl: null };
    const cal = await resolveOutboundContextCalendar(rowMissingContact, {
      lifecyclePayload: { routing: { niche_key: "only" } },
    });
    assert.equal(cal.calendarSource, "none");
  } finally {
    if (prev === undefined) delete process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
    else process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = prev;
    resetOutboundCalendarMapCacheForTests();
  }
});

test("webhook DB fallback skipped without clientAccountId (cannot match another tenant log)", async () => {
  resetOutboundCalendarMapCacheForTests();
  const prev = process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
  process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = "";
  try {
    const rowNoClient = { ...mockRow, contactIdGhl: "ghl_x", clientAccountId: "" };
    const cal = await resolveOutboundContextCalendar(rowNoClient, {
      lifecyclePayload: { routing: {} },
    });
    assert.equal(cal.calendarSource, "none");
  } finally {
    if (prev === undefined) delete process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
    else process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = prev;
    resetOutboundCalendarMapCacheForTests();
  }
});

test("lifecycle routing calendar wins over webhook request body", async () => {
  const cal = await resolveOutboundContextCalendar(rowNoContactId, {
    lifecyclePayload: {
      routing: {
        calendar_id: "from_lifecycle",
        calendar_link: "https://lifecycle.example/book",
      },
    },
    webhookRequestBody: {
      routing: {
        calendar_id: "from_webhook",
        calendar_link: "https://webhook.example/book",
      },
    },
  });
  assert.equal(cal.calendarSource, "routing");
  assert.equal(cal.schedulingCalendarId, "from_lifecycle");
  assert.equal(cal.schedulingCalendarLink, "https://lifecycle.example/book");
});

test("invalid placeholder calendar fields in lifecycle + webhook → env map still applies", async () => {
  resetOutboundCalendarMapCacheForTests();
  const prev = process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
  process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = JSON.stringify({
    defaultByClientAccountId: {
      ca1: { calendarId: "env_cal", calendarLink: "https://env.fallback" },
    },
  });
  try {
    const cal = await resolveOutboundContextCalendar(rowNoContactId, {
      lifecyclePayload: {
        routing: {
          calendar_id: "{{contact.sa360_calendar_id}}",
          calendar_link: "<placeholder>",
        },
      },
      webhookRequestBody: {
        routing: {
          calendar_id: "null",
          calendar_link: "undefined",
        },
      },
    });
    assert.equal(cal.calendarSource, "client_default");
    assert.equal(cal.schedulingCalendarId, "env_cal");
  } finally {
    if (prev === undefined) delete process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
    else process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = prev;
    resetOutboundCalendarMapCacheForTests();
  }
});

test("lifecycle, webhook placeholders, and env empty → missing_calendar", async () => {
  resetOutboundCalendarMapCacheForTests();
  const prev = process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
  process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = "";
  try {
    const cal = await resolveOutboundContextCalendar(rowNoContactId, {
      lifecyclePayload: { routing: { niche_key: "only" } },
      webhookRequestBody: {
        routing: {
          calendar_id: "{{ignored}}",
          calendar_link: "<ignored>",
        },
      },
    });
    assert.equal(cal.calendarSource, "none");
    const guard = resolveOutboundGuardrails({
      contactFound: true,
      hasActiveAppointment: false,
      calendarIdPresent: false,
      newBookingCalendarReady: false,
      assignedAgentId: "a1",
      doNotCallSignal: false,
      routingCalendarComplete: false,
    });
    assert.equal(guard.scriptGoal, "REVIEW_REQUIRED");
    assert.equal(guard.doNotBookReason, "missing_calendar");
  } finally {
    if (prev === undefined) delete process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
    else process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = prev;
    resetOutboundCalendarMapCacheForTests();
  }
});

test("no routing and no env map → missing calendar", async () => {
  resetOutboundCalendarMapCacheForTests();
  const prev = process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
  process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = "";
  try {
    const cal = await resolveOutboundContextCalendar(mockRow, {
      lifecyclePayload: { routing: { niche_key: "only" } },
    });
    assert.equal(cal.calendarSource, "none");
    const guard = resolveOutboundGuardrails({
      contactFound: true,
      hasActiveAppointment: false,
      calendarIdPresent: false,
      newBookingCalendarReady: false,
      assignedAgentId: "a1",
      doNotCallSignal: false,
      routingCalendarComplete: false,
    });
    assert.equal(guard.scriptGoal, "REVIEW_REQUIRED");
    assert.equal(guard.doNotBookReason, "missing_calendar");
  } finally {
    if (prev === undefined) delete process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON;
    else process.env.SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON = prev;
    resetOutboundCalendarMapCacheForTests();
  }
});
