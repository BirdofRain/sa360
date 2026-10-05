import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canRequeueMetaFetch, metaFetchBadgeClass, sourceClientLabel } from "./meta-fetch-presentation";
import type { MetaLeadgenFetchState } from "./types";

function fetchState(state: string): MetaLeadgenFetchState {
  return {
    state,
    jobId: `meta-leadgen-fetch-${state}`,
    attempt: 1,
    queuedAt: "2026-10-01T00:00:00.000Z",
    requeuedAt: null,
    enqueueFailedAt: null,
    fetchStartedAt: null,
    fetchFinishedAt: null,
    graphOutcome: null,
    graphStatus: null,
    graphErrorCode: null,
    graphErrorMessage: null,
    tokenScope: null,
    liveDelivery: false,
    capiDispatched: false,
  };
}

describe("canRequeueMetaFetch", () => {
  it("allows requeue for raw meta_lead_ads rows whose fetch failed, never enqueued, or stalled", () => {
    for (const state of ["failed", "enqueue_failed", "retrying", "queued"]) {
      assert.equal(
        canRequeueMetaFetch({ sourceSystem: "meta_lead_ads", status: "received", metaLeadgenFetch: fetchState(state) }),
        true,
        state
      );
    }
    // Stored while SA360_META_LEAD_ADS_INTAKE_ENABLED was off: no fetch state at all.
    assert.equal(canRequeueMetaFetch({ sourceSystem: "meta_lead_ads", status: "received" }), true, "never queued");
    assert.equal(
      canRequeueMetaFetch({ sourceSystem: "meta_lead_ads", status: "received", metaLeadgenFetch: null }),
      true,
      "null fetch meta"
    );
  });

  it("refuses settled, non-Meta, in-flight, or already-normalized rows", () => {
    assert.equal(
      canRequeueMetaFetch({
        sourceSystem: "meta_lead_ads",
        status: "received",
        captureOnly: true,
        metaLeadgenFetch: fetchState("failed"),
      }),
      false,
      "settled capture-only row"
    );
    assert.equal(
      canRequeueMetaFetch({ sourceSystem: "zapier_facebook", status: "received", metaLeadgenFetch: fetchState("failed") }),
      false,
      "zapier row"
    );
    assert.equal(
      canRequeueMetaFetch({ sourceSystem: "meta_lead_ads", status: "received", metaLeadgenFetch: fetchState("fetching") }),
      false,
      "fetch in flight"
    );
    for (const status of ["normalized", "routing_matched", "needs_review", "delivered"]) {
      assert.equal(
        canRequeueMetaFetch({ sourceSystem: "meta_lead_ads", status, metaLeadgenFetch: fetchState("failed") }),
        false,
        `row already ${status}`
      );
    }
  });
});

describe("sourceClientLabel", () => {
  it("shows the association client independently of any delivery destination", () => {
    assert.equal(
      sourceClientLabel({ captureOnly: true, sourceClientAccountId: "ca_danielle", associationOutcome: "associated" }),
      "ca_danielle"
    );
  });

  it("explains why no source client exists instead of borrowing routing fields", () => {
    assert.equal(sourceClientLabel({ captureOnly: true, associationOutcome: "unmatched" }), "unassociated");
    assert.equal(sourceClientLabel({ captureOnly: true, associationOutcome: "ambiguous" }), "ambiguous");
    assert.equal(sourceClientLabel({ captureOnly: true, associationOutcome: "association_disabled" }), "association off");
    assert.equal(sourceClientLabel({ captureOnly: true, associationOutcome: "missing_form_identity" }), "no form identity");
    assert.equal(sourceClientLabel({ captureOnly: false, sourceClientAccountId: "ca_x" }), "—");
  });
});

describe("metaFetchBadgeClass", () => {
  it("maps terminal failures to destructive and settled states to success", () => {
    assert.match(metaFetchBadgeClass("failed"), /destructive/);
    assert.match(metaFetchBadgeClass("enqueue_failed"), /destructive/);
    assert.match(metaFetchBadgeClass("captured"), /emerald/);
    assert.match(metaFetchBadgeClass("retrying"), /amber/);
    assert.match(metaFetchBadgeClass("queued"), /muted/);
    assert.match(metaFetchBadgeClass(null), /muted/);
  });
});
