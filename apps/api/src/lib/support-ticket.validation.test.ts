import assert from "node:assert/strict";
import test from "node:test";

import {
  appendInternalNote,
  normalizeSupportTicketCategory,
  normalizeSupportTicketPriority,
  normalizeSupportTicketStatus,
  parseInternalNotes,
  requireDescription,
  trimOrNull,
} from "../lib/support-ticket.validation.js";

test("requireDescription rejects empty and over-max", () => {
  assert.equal(requireDescription(""), null);
  assert.equal(requireDescription("   "), null);
  assert.equal(requireDescription("hello"), "hello");
  assert.equal(requireDescription("x".repeat(5001)), null);
});

test("invalid priority/category/status fall back safely", () => {
  assert.equal(normalizeSupportTicketStatus("bogus"), "OPEN");
  assert.equal(normalizeSupportTicketStatus("IN_PROGRESS"), "IN_PROGRESS");
  assert.equal(normalizeSupportTicketPriority("urgent"), "URGENT");
  assert.equal(normalizeSupportTicketPriority("???"), "NORMAL");
  assert.equal(normalizeSupportTicketCategory("webhook"), "WEBHOOK");
  assert.equal(normalizeSupportTicketCategory("???"), "GENERAL");
});

test("trimOrNull truncates long strings", () => {
  assert.equal(trimOrNull("  hi  ", 10), "hi");
  assert.equal(trimOrNull("a".repeat(20), 5), "aaaaa");
});

test("appendInternalNote appends safely", () => {
  const first = appendInternalNote([], "First note", "alice", new Date("2026-06-04T12:00:00Z"));
  assert.equal(first.length, 1);
  const second = appendInternalNote(first, "Second", "bob", new Date("2026-06-04T13:00:00Z"));
  assert.equal(second.length, 2);
  assert.equal(parseInternalNotes(second)[1]?.by, "bob");
});

test("appendInternalNote ignores blank note", () => {
  const notes = appendInternalNote([], "   ", "alice", new Date());
  assert.equal(notes.length, 0);
});
