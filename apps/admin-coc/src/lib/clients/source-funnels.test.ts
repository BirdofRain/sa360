import assert from "node:assert/strict";
import test from "node:test";

import {
  associateSuccessMessage,
  CLEAR_ASSOCIATION_CONFIRM_COPY,
  clearSuccessMessage,
  confirmSuccessMessage,
  formatSourceFunnelSeenAt,
  isWaitingForFirstLead,
  LEADCAPTURE_SOURCES_EMPTY_INPUT,
  operatorSafeSourceFunnelError,
  parseSourceFunnelConflict,
  partitionClientSourceFunnels,
  reassignConfirmCopy,
  reassignSuccessMessage,
  sourceFunnelDisplayName,
  sourceFunnelNicheLabel,
  type SourceFunnelAdminItem,
} from "./source-funnels.ts";

function item(partial: Partial<SourceFunnelAdminItem> & { id: string }): SourceFunnelAdminItem {
  return {
    provider: "leadcapture_io",
    providerFunnelId: null,
    parentUrlKey: `my.leadcapture.io/p/${partial.pageSlug ?? partial.id}`,
    pageSlug: partial.pageSlug ?? partial.id,
    observedFunnelName: null,
    nicheKey: null,
    associationStatus: "confirmed",
    suggestedClientAccountId: null,
    originClientAccountId: "client_a",
    firstSeenAt: null,
    lastSeenAt: null,
    ...partial,
  };
}

test("sourceFunnelDisplayName falls back when the observed name is unknown", () => {
  assert.equal(
    sourceFunnelDisplayName({
      observedFunnelName: "Life Insurance For Veterans - Madison Pimentel V2",
    }),
    "Life Insurance For Veterans - Madison Pimentel V2"
  );
  assert.equal(sourceFunnelDisplayName({ observedFunnelName: null }), "LeadCapture source");
});

test("sourceFunnelNicheLabel maps vet_fex to Veteran", () => {
  assert.equal(sourceFunnelNicheLabel("vet_fex"), "Veteran");
  assert.equal(sourceFunnelNicheLabel(null), null);
});

test("waiting for first lead is firstSeenAt null", () => {
  assert.equal(isWaitingForFirstLead({ firstSeenAt: null }), true);
  assert.equal(isWaitingForFirstLead({ firstSeenAt: "2026-09-10T00:00:00.000Z" }), false);
});

test("formatSourceFunnelSeenAt uses a short month-day label", () => {
  const label = formatSourceFunnelSeenAt("2026-09-10T15:00:00.000Z");
  assert.ok(label);
  assert.match(label, /Sep/);
  assert.match(label, /10/);
});

test("success copy never invents inventory counts", () => {
  assert.equal(
    associateSuccessMessage({ created: true, backfilledInventoryCount: 0, firstSeenAt: null }),
    "LeadCapture source associated. Waiting for the first lead from this page."
  );
  assert.equal(
    associateSuccessMessage({ created: false, backfilledInventoryCount: 27, firstSeenAt: "2026-09-10T00:00:00.000Z" }),
    "LeadCapture source associated. 27 existing inventory records were tagged with this origin client."
  );
  assert.equal(
    associateSuccessMessage({ created: false, backfilledInventoryCount: 0, firstSeenAt: "2026-09-10T00:00:00.000Z" }),
    "LeadCapture source associated."
  );
  assert.equal(confirmSuccessMessage(0), "LeadCapture source associated.");
  assert.equal(
    reassignSuccessMessage({ newlyStamped: 0, reassigned: 12, conflictsSkipped: 1 }),
    "Source reassigned. 12 inventory records were corrected. 1 conflicting record was left unchanged."
  );
  assert.equal(clearSuccessMessage(12), "Source association removed. 12 matching inventory records were cleared.");
  assert.equal(clearSuccessMessage(0), "Source association removed.");
});

test("reassign and clear confirmation copy names both clients", () => {
  assert.match(
    reassignConfirmCopy({ currentOwner: "Madison Pimentel", newOwner: "Madison Test Client" }),
    /Madison Pimentel/
  );
  assert.match(CLEAR_ASSOCIATION_CONFIRM_COPY, /does not delete the source/);
  assert.equal(LEADCAPTURE_SOURCES_EMPTY_INPUT, "Enter a LeadCapture page URL or slug.");
});

test("partitionClientSourceFunnels keeps confirmed and suggested separate", () => {
  const { confirmed, suggested } = partitionClientSourceFunnels([
    item({ id: "1", pageSlug: "dn_omzoj", associationStatus: "confirmed" }),
    item({
      id: "2",
      pageSlug: "sugg",
      associationStatus: "suggested",
      originClientAccountId: null,
      suggestedClientAccountId: "client_a",
    }),
  ]);
  assert.equal(confirmed.length, 1);
  assert.equal(suggested.length, 1);
});

test("parseSourceFunnelConflict reads operator-safe 409 JSON", () => {
  const conflict = parseSourceFunnelConflict(
    JSON.stringify({
      ok: false,
      error: "This source is already associated with another client.",
      code: "confirm_requires_explicit_reassign",
      sourceFunnelId: "sf_1",
      currentOriginClientAccountId: "client_b",
      currentOriginClientDisplayName: "Madison Pimentel",
      requestedOriginClientAccountId: "client_a",
    })
  );
  assert.ok(conflict);
  assert.equal(conflict.currentOriginClientDisplayName, "Madison Pimentel");
  assert.equal(parseSourceFunnelConflict("not json"), null);
});

test("operatorSafeSourceFunnelError hides prisma/sql/stack traces", () => {
  assert.equal(
    operatorSafeSourceFunnelError("PrismaClientKnownRequestError: SQLSTATE"),
    "Unable to complete source association."
  );
  assert.equal(
    operatorSafeSourceFunnelError("That value could not be recognized as a valid LeadCapture source."),
    "That value could not be recognized as a valid LeadCapture source."
  );
});
