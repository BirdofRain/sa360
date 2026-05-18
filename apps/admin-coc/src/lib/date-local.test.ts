import test from "node:test";
import assert from "node:assert/strict";
import {
  dateOnlyInputToIso,
  dateOnlyToLocalDayRangeIso,
  datetimeLocalStringToIso,
  formatDatetimeLocalFromDate,
  isoStringToDatetimeLocalValue,
  isoToDateOnlyInputValue,
  localeFormatCalendarDayFromIso,
  parseDateOnlyLocal,
  parseDatetimeLocalString,
} from "./date-local.ts";

test("legacy UTC date-only ISO formats without shifting calendar day", () => {
  const s = localeFormatCalendarDayFromIso("2026-05-18T00:00:00.000Z");
  assert.ok(s && s.length > 3);
  assert.equal(isoToDateOnlyInputValue("2026-05-18T00:00:00.000Z"), "2026-05-18");
});

test("parseDateOnlyLocal accepts valid calendar dates", () => {
  assert.deepEqual(parseDateOnlyLocal("2026-05-18"), { year: 2026, month: 5, day: 18 });
  assert.equal(parseDateOnlyLocal("2026-13-01"), null);
  assert.equal(parseDateOnlyLocal("2026-05-32"), null);
  assert.equal(parseDateOnlyLocal("not-a-date"), null);
});

test("legacy UTC-midnight ISO maps to same calendar date in date input", () => {
  assert.equal(isoToDateOnlyInputValue("2026-05-18T00:00:00.000Z"), "2026-05-18");
});

test("date-only round-trip preserves calendar day in local timezone", () => {
  const iso = dateOnlyInputToIso("2026-05-18");
  assert.ok(iso);
  assert.equal(isoToDateOnlyInputValue(iso), "2026-05-18");
});

test("parseDatetimeLocalString preserves wall time components", () => {
  const d = parseDatetimeLocalString("2026-05-18T09:07");
  assert.ok(d);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 4);
  assert.equal(d.getDate(), 18);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 7);
});

test("datetime-local round-trip via ISO string", () => {
  const iso = datetimeLocalStringToIso("2026-05-18T14:30");
  assert.ok(iso);
  assert.equal(isoStringToDatetimeLocalValue(iso), "2026-05-18T14:30");
});

test("formatDatetimeLocalFromDate aligns with parseDatetimeLocalString", () => {
  const d = parseDatetimeLocalString("2026-12-01T00:00");
  assert.ok(d);
  assert.equal(formatDatetimeLocalFromDate(d), "2026-12-01T00:00");
});

test("dateOnlyToLocalDayRangeIso spans local start and end of day", () => {
  const r = dateOnlyToLocalDayRangeIso("2026-05-18");
  assert.ok(r);
  const start = new Date(r.startIso);
  const end = new Date(r.endIso);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getSeconds(), 0);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
  assert.equal(end.getSeconds(), 59);
  assert.ok(end.getTime() >= start.getTime());
});
