import assert from "node:assert/strict";
import test from "node:test";

import { applySupportTicketDefaults } from "../services/support-ticket.service.js";
import { appendInternalNote } from "../lib/support-ticket.validation.js";

test("applySupportTicketDefaults uses OPEN NORMAL GENERAL for invalid input", () => {
  const d = applySupportTicketDefaults({
    status: "bogus",
    priority: "???",
    category: "nope",
  });
  assert.equal(d.status, "OPEN");
  assert.equal(d.priority, "NORMAL");
  assert.equal(d.category, "GENERAL");
});

test("appendInternalNote preserves order for update flow", () => {
  const notes = appendInternalNote([], "First", "admin", new Date("2026-06-04T12:00:00Z"));
  const next = appendInternalNote(notes, "Second", "ops", new Date("2026-06-04T13:00:00Z"));
  assert.equal(next.length, 2);
  assert.equal(next[1]?.note, "Second");
});
