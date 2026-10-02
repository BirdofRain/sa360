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
  it("allows requeue only for raw meta_lead_ads rows whose fetch failed or never enqueued", () => {
    for (const state of ["failed", "enqueue_failed", "retrying"]) {
      assert.equal(
        canRequeueMetaFetch({ sourceSystem: "meta_lead_ads", status: "received", metaLeadgenFetch: fetchState(state) }),
        true,
        state
      );
    }
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
    for (const state of ["queued", "fetching", "captured", "normalized"]) {
      assert.equal(
        canRequeueMetaFetch({ sourceSystem: "meta_lead_ads", status: "received", metaLeadgenFetch: fetchState(state) }),
        false,
        state
      );
    }
    assert.equal(
      canRequeueMetaFetch({ sourceSystem: "meta_lead_ads", status: "normalized", metaLeadgenFetch: fetchState("failed") }),
      false,
      "row already normalized by routing path"
    );
    assert.equal(canRequeueMetaFetch({ sourceSystem: "meta_lead_ads", status: "received" }), false, "no fetch meta");
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
