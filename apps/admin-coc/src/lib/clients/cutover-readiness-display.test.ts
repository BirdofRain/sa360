import test from "node:test";
import assert from "node:assert/strict";
import {
  countSectionProgress,
  isGhlDestinationBlocker,
  isLegacyRoutingRuleBlocker,
  legacyMasterRoutingApplicability,
  legacyRoutingApplicabilityLabel,
  normalizeCutoverReadinessReport,
  overallStatusBadgeClass,
  overallStatusLabel,
} from "./cutover-readiness-display.ts";
import type { ClientCutoverReadinessReport, CutoverReadinessSection } from "./cutover-readiness-types.ts";

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

function routingReport(detail: {
  activeDetail: string;
  masterComplete: boolean;
  masterDetail: string;
}): ClientCutoverReadinessReport {
  return {
    clientAccountId: "client",
    clientDisplayName: "Client",
    status: "active",
    generatedAt: "2026-11-12T00:00:00.000Z",
    overallStatus: "not_ready",
    sections: [
      {
        key: "routing_rules",
        label: "Routing rules",
        complete: false,
        items: [
          {
            key: "active_rule_exists",
            label: "At least one active routing rule",
            complete: detail.activeDetail.startsWith("0 ") === false,
            detail: detail.activeDetail,
          },
          {
            key: "rule_master_source",
            label: "Master lead source mapped",
            complete: detail.masterComplete,
            detail: detail.masterDetail,
          },
        ],
      },
    ],
    blockers: [],
    warnings: [],
    manualNextSteps: [],
  };
}

test("legacy routing applicability is the master-source model only when an active rule maps a master", () => {
  assert.equal(
    legacyMasterRoutingApplicability(
      routingReport({ activeDetail: "1 active of 1 total", masterComplete: true, masterDetail: "lal_master_vet" })
    ),
    "legacy_master_source"
  );
  assert.equal(
    legacyMasterRoutingApplicability(
      routingReport({ activeDetail: "0 active of 0 total", masterComplete: false, masterDetail: "no master source" })
    ),
    "unknown"
  );
  assert.equal(
    legacyMasterRoutingApplicability(
      routingReport({ activeDetail: "0 active of 2 total", masterComplete: false, masterDetail: "no master source" })
    ),
    "unknown"
  );
  assert.equal(
    legacyMasterRoutingApplicability(routingReport({ activeDetail: "unclear", masterComplete: true, masterDetail: "lal_master_vet" })),
    "unknown"
  );
  assert.equal(legacyRoutingApplicabilityLabel("legacy_master_source"), "Applies to legacy master-source routing");
  assert.equal(legacyRoutingApplicabilityLabel("unknown"), "Unknown");
});

test("destination blockers stay distinct from the legacy routing-rule blocker", () => {
  assert.equal(isGhlDestinationBlocker("GHL destination is not configured for this client."), true);
  assert.equal(isGhlDestinationBlocker("Destination: pipeline missing"), true);
  assert.equal(isGhlDestinationBlocker("No active routing rule maps a master source to this client."), false);
  assert.equal(isLegacyRoutingRuleBlocker("No active routing rule maps a master source to this client."), true);
  assert.equal(isLegacyRoutingRuleBlocker("Portal is enabled but no portalLoginEmail is set."), false);
});
