import assert from "node:assert/strict";
import test from "node:test";

import {
  sheetsEventAlreadyWritten,
  sheetsEventWriteDisposition,
  type SheetsEventWriteSnapshot,
} from "./sheets-event-write-guard.js";

const TEST_KEY = "captured-event-test:client_a:evt_1";
const LEAD_KEY = "lead:client_a:evt_1";

function job(overrides: Partial<SheetsEventWriteSnapshot> & Pick<SheetsEventWriteSnapshot, "idempotencyKey">): SheetsEventWriteSnapshot {
  return {
    id: overrides.idempotencyKey,
    status: "queued",
    rowsWritten: 0,
    appendStartedAt: null,
    ...overrides,
  };
}

test("a succeeded automatic row blocks another captured test write", () => {
  const jobs = [job({ idempotencyKey: LEAD_KEY, status: "succeeded", rowsWritten: 1 })];
  assert.equal(sheetsEventWriteDisposition(jobs, TEST_KEY), "already_written");
  assert.equal(sheetsEventAlreadyWritten(jobs, TEST_KEY)?.idempotencyKey, LEAD_KEY);
});

test("a succeeded captured test blocks automatic delivery of the same event", () => {
  const jobs = [job({ idempotencyKey: TEST_KEY, status: "succeeded", rowsWritten: 1 })];
  assert.equal(sheetsEventWriteDisposition(jobs, LEAD_KEY), "already_written");
});

test("an uncertain or in-flight record holds the other path", () => {
  assert.equal(
    sheetsEventWriteDisposition([job({ idempotencyKey: LEAD_KEY, status: "uncertain" })], TEST_KEY),
    "hold"
  );
  assert.equal(
    sheetsEventWriteDisposition(
      [job({ idempotencyKey: TEST_KEY, status: "failed", appendStartedAt: new Date("2026-10-29T12:00:00.000Z") })],
      LEAD_KEY
    ),
    "hold"
  );
  assert.equal(
    sheetsEventWriteDisposition([job({ idempotencyKey: TEST_KEY, status: "queued" })], LEAD_KEY),
    "hold"
  );
});

test("a pre-send failure on the other key does not block a new write", () => {
  const jobs = [job({ idempotencyKey: LEAD_KEY, status: "failed", rowsWritten: 0, appendStartedAt: null })];
  assert.equal(sheetsEventWriteDisposition(jobs, TEST_KEY), "clear");
  assert.equal(sheetsEventAlreadyWritten(jobs, TEST_KEY), null);
});

test("the path's own key is not treated as another write", () => {
  const jobs = [job({ idempotencyKey: TEST_KEY, status: "succeeded", rowsWritten: 1 })];
  assert.equal(sheetsEventWriteDisposition(jobs, TEST_KEY), "clear");
});
