import test from "node:test";
import assert from "node:assert/strict";
import {
  extractRoutingCalendarFromLifecyclePayload,
  isUsableCalendarFieldValue,
  normalizeRoutingCalendarField,
} from "./lifecycle-routing-calendar.js";

test("normalizeRoutingCalendarField rejects placeholders and sentinels", () => {
  assert.equal(normalizeRoutingCalendarField(""), "");
  assert.equal(normalizeRoutingCalendarField("null"), "");
  assert.equal(normalizeRoutingCalendarField("undefined"), "");
  assert.equal(normalizeRoutingCalendarField("  {{contact.sa360_calendar_id}}  "), "");
  assert.equal(normalizeRoutingCalendarField("<calendar_id>"), "");
  assert.equal(normalizeRoutingCalendarField("cal_real_1"), "cal_real_1");
});

test("isUsableCalendarFieldValue", () => {
  assert.equal(isUsableCalendarFieldValue("https://example.com/book"), true);
  assert.equal(isUsableCalendarFieldValue("{{x}}"), false);
});

test("extractRoutingCalendarFromLifecyclePayload prefers primary then sa360", () => {
  assert.deepEqual(
    extractRoutingCalendarFromLifecyclePayload({
      routing: {
        calendar_id: "p1",
        calendar_link: "https://primary",
        sa360_calendar_id: "s1",
        sa360_calendar_link: "https://sa360",
      },
    }),
    { calendarId: "p1", calendarLink: "https://primary" }
  );

  assert.deepEqual(
    extractRoutingCalendarFromLifecyclePayload({
      routing: {
        sa360_calendar_id: "s1",
        sa360_calendar_link: "https://sa360",
      },
    }),
    { calendarId: "s1", calendarLink: "https://sa360" }
  );

  assert.deepEqual(
    extractRoutingCalendarFromLifecyclePayload({
      routing: {
        calendar_id: "p1",
        sa360_calendar_link: "https://only-link",
      },
    }),
    { calendarId: "p1", calendarLink: "https://only-link" }
  );
});
