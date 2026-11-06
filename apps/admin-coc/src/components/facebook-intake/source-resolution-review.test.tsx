import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { SourceResolutionReview } from "./source-resolution-review.tsx";
import type { SourceResolutionReviewView } from "@/lib/facebook-intake/source-resolution.ts";

function review(overrides: Partial<SourceResolutionReviewView> = {}): SourceResolutionReviewView {
  return {
    readOnly: true,
    writesPerformed: false,
    summary: {
      events: 83,
      byStatus: [{ status: "normalized", events: 81 }, { status: "received", events: 2 }],
      settledCaptureOnly: 81,
      unresolvedClient: 83,
      unstampedDespiteConfirmedOwner: 81,
      cannotIdentify: 2,
      invalidSourceIdentifiers: 0,
      unresolvedWithPageFormAndCampaign: 0,
    },
    associations: {
      items: [
        {
          id: "funnel_jr",
          pageId: "222591640945329",
          formId: "1977370106440985",
          associationStatus: "confirmed",
          originClientAccountId: "jr_laird",
          suggestedClientAccountId: null,
          ownership: "confirmed",
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
      truncated: false,
    },
    groups: {
      items: [
        {
          pageId: "222591640945329",
          formId: "1977370106440985",
          campaignId: null,
          unresolvedEvents: 81,
          classification: "unstamped_confirmed_owner",
          confirmedOriginClientAccountId: "jr_laird",
          confirmedSourceFunnelId: "funnel_jr",
          sourceFunnelCreatedAt: null,
          sourceFunnelUpdatedAt: null,
          earliestReceivedAt: null,
          latestReceivedAt: null,
          outcomes: {
            associated: 0,
            unassociated: 81,
            ambiguous: 0,
            missingFormIdentity: 0,
            invalidFormIdentity: 0,
            notEvaluated: 0,
            associationDisabled: 0,
            absent: 0,
            other: 0,
          },
          explanation: "Settlement recorded unassociated.",
          events: [],
        },
        {
          pageId: null,
          formId: null,
          campaignId: null,
          unresolvedEvents: 2,
          classification: "cannot_identify",
          confirmedOriginClientAccountId: null,
          confirmedSourceFunnelId: null,
          sourceFunnelCreatedAt: null,
          sourceFunnelUpdatedAt: null,
          earliestReceivedAt: null,
          latestReceivedAt: null,
          outcomes: {
            associated: 0,
            unassociated: 0,
            ambiguous: 0,
            missingFormIdentity: 2,
            invalidFormIdentity: 0,
            notEvaluated: 0,
            associationDisabled: 0,
            absent: 0,
            other: 0,
          },
          explanation: "Page ID and Form ID are not both numeric Facebook IDs.",
          events: [],
        },
      ],
      total: 2,
      limit: 25,
      offset: 0,
    },
    ...overrides,
  };
}

test.afterEach(() => {
  cleanup();
});

test("source resolution review shows unstamped events apart from events that cannot be identified", () => {
  render(React.createElement(SourceResolutionReview, { review: review(), error: null }));
  assert.equal(screen.queryByRole("button", { name: /reevaluate|save|import|confirm/i }), null);
  assert.ok(screen.getByText("Unresolved. A confirmed SourceFunnel matches."));
  assert.ok(screen.getByText("jr_laird"));
  assert.ok(screen.getByText("Cannot identify. Page or Form is missing."));
  assert.equal(screen.queryByText("Already associated"), null);
  assert.ok(screen.getByText(/does not change ownership/));
});

test("source resolution review shows an empty unresolved state", () => {
  const empty = review();
  empty.summary.events = 0;
  empty.summary.unresolvedClient = 0;
  empty.summary.unstampedDespiteConfirmedOwner = 0;
  empty.summary.cannotIdentify = 0;
  empty.groups.items = [];
  empty.groups.total = 0;
  empty.associations.items = [];
  render(React.createElement(SourceResolutionReview, { review: empty, error: null }));
  assert.ok(screen.getByText("No confirmed Facebook SourceFunnel owners in this view."));
  assert.ok(screen.getByText("No unresolved Meta Lead Ads events match this view."));
});

test("source resolution review shows an error without a mutation control", () => {
  render(
    React.createElement(SourceResolutionReview, {
      review: null,
      error: "Admin API is not configured.",
    })
  );
  assert.ok(screen.getByText("Source Resolution review unavailable"));
  assert.ok(screen.getByText("Admin API is not configured."));
  assert.equal(screen.queryByRole("button", { name: /save|reevaluate/i }), null);
});
