import test from "node:test";
import assert from "node:assert/strict";
import {
  countSectionProgress,
  normalizeCutoverReadinessReport,
  overallStatusBadgeClass,
  overallStatusLabel,
} from "./cutover-readiness-display.ts";
import type { CutoverReadinessSection } from "./cutover-readiness-types.ts";

test("overallStatusLabel maps known statuses and falls back", () => {
  assert.equal(overallStatusLabel("ready_for_live_review"), "Ready for live review");
  assert.equal(overallStatusLabel("ready_for_shadow"), "Ready for shadow");
  assert.equal(overallStatusLabel("blocked"), "Blocked");
  assert.equal(overallStatusLabel("not_ready"), "Not ready");
  assert.equal(overallStatusLabel("garbage"), "Unknown");
  assert.equal(overallStatusLabel(null), "Unknown");
});

test("overallStatusBadgeClass returns a non-empty class for each status", () => {
  for (const s of ["ready_for_live_review", "ready_for_shadow", "blocked", "not_ready"]) {
    assert.ok(overallStatusBadgeClass(s).length > 0);
  }
  assert.ok(overallStatusBadgeClass("unknown").length > 0);
});

test("countSectionProgress counts completed items", () => {
  const section: CutoverReadinessSection = {
    key: "routing_rules",
    label: "Routing rules",
    complete: false,
    items: [
      { key: "a", label: "A", complete: true },
      { key: "b", label: "B", complete: false },
      { key: "c", label: "C", complete: true },
    ],
  };
  assert.deepEqual(countSectionProgress(section), { complete: 2, total: 3 });
});

test("normalizeCutoverReadinessReport returns null for non-objects", () => {
  assert.equal(normalizeCutoverReadinessReport(null), null);
  assert.equal(normalizeCutoverReadinessReport(undefined), null);
  assert.equal(normalizeCutoverReadinessReport("nope"), null);
  assert.equal(normalizeCutoverReadinessReport({}), null);
});

test("normalizeCutoverReadinessReport coerces a well-formed report", () => {
  const report = normalizeCutoverReadinessReport({
    clientAccountId: "pilot_client",
    clientDisplayName: "Pilot",
    status: "onboarding",
    generatedAt: "2026-01-01T00:00:00.000Z",
    overallStatus: "ready_for_shadow",
    sections: [
      {
        key: "client_account",
        label: "Client account",
        complete: true,
        items: [{ key: "client_exists", label: "Exists", complete: true, detail: "pilot_client" }],
      },
    ],
    blockers: ["b1"],
    warnings: ["w1"],
    manualNextSteps: ["step1"],
  });
  assert.ok(report);
  assert.equal(report?.overallStatus, "ready_for_shadow");
  assert.equal(report?.sections.length, 1);
  assert.equal(report?.sections[0]?.items[0]?.detail, "pilot_client");
  assert.deepEqual(report?.blockers, ["b1"]);
});

test("normalizeCutoverReadinessReport defends against malformed parts", () => {
  const report = normalizeCutoverReadinessReport({
    clientAccountId: "pilot_client",
    overallStatus: "not_a_status",
    sections: [
      { key: "client_account", label: "Client account", items: "bad", complete: "yes" },
      { label: "missing key" },
      "garbage",
      {
        key: "routing_rules",
        label: "Routing rules",
        complete: true,
        items: [{ key: "ok", label: "OK", complete: true }, { label: "no key" }, 42],
      },
    ],
    blockers: ["ok", 5, null],
    warnings: "not-an-array",
  });
  assert.ok(report);
  assert.equal(report?.overallStatus, "not_ready");
  assert.equal(report?.clientDisplayName, "pilot_client");
  assert.equal(report?.status, "unknown");
  assert.equal(report?.sections.length, 2);
  const rules = report?.sections.find((s) => s.key === "routing_rules");
  assert.equal(rules?.items.length, 1);
  assert.deepEqual(report?.blockers, ["ok"]);
  assert.deepEqual(report?.warnings, []);
});
