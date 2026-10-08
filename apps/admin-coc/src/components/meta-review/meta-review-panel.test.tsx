import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import type { MetaReviewPreflight, MetaReviewTrace } from "@/lib/meta-review/types";
import { MetaReviewPanel } from "./meta-review-panel";

const trace: MetaReviewTrace = {
  method: "GET",
  endpoint: "/v25.0/me/accounts?fields=id,name,tasks",
  httpStatus: 200,
  ok: true,
  timestamp: "2026-10-08T21:00:00.000Z",
  error: null,
};

function preflight(overrides: Partial<MetaReviewPreflight> = {}): MetaReviewPreflight {
  return {
    enabled: true,
    writesEnabled: false,
    graphApiVersion: "v25.0",
    tokens: {
      userOrSystemUser: { configured: true, masked: "configured (masked)" },
      page: { configured: true, masked: "configured (masked)", boundPageId: "10001" },
    },
    allowlists: { pageIds: ["10001"], adAccountIds: ["act_20001"] },
    callback: {
      configured: true,
      routes: ["/sources/facebook/lead-created", "/webhooks/meta/leadgen"],
    },
    productionSafety: {
      intakeEnabled: false,
      graphFetchEnabled: false,
      routingEnabled: false,
      legacyDirectIntakeEnabled: false,
      safeForReview: true,
    },
    requiredTokens: {},
    ...overrides,
  };
}

test.afterEach(cleanup);

test("review UI renders permission panels and only sanitized authorized results", async () => {
  const secret = "EAA-secret-must-not-render";
  const view = render(
    <MetaReviewPanel
      preflight={preflight()}
      defaultSince="2026-10-01"
      defaultUntil="2026-10-07"
      loadPages={async () => ({
        ok: true,
        data: [{ id: "10001", name: "Dedicated Review Page", tasks: ["MANAGE"] }],
        trace,
      })}
      loadPermissions={async () => ({
        ok: true,
        data: [{ permission: "pages_show_list", status: "granted" }],
        trace: { ...trace, endpoint: "/v25.0/me/permissions" },
      })}
      loadSubscription={async () => ({
        ok: true,
        data: [],
        trace: { ...trace, endpoint: "/v25.0/10001/subscribed_apps" },
      })}
      loadPosts={async () => ({
        ok: true,
        data: [],
        trace: { ...trace, endpoint: "/v25.0/10001/posts" },
      })}
      loadInsights={async () => ({
        ok: true,
        data: [],
        trace: { ...trace, endpoint: "/v25.0/act_20001/insights" },
      })}
      subscribeLeadgen={async () => ({
        ok: false,
        error: "Writes disabled.",
        trace: null,
      })}
    />
  );

  assert.ok(screen.getByText(/Connected Pages.*pages_show_list/));
  assert.ok(screen.getByText(/Leadgen subscription.*pages_manage_metadata/));
  assert.ok(screen.getByText(/Page-owned content.*pages_read_engagement/));
  assert.ok(screen.getByText(/Campaign insights.*ads_read/));
  assert.ok(screen.getByText("WRITES DISABLED"));

  fireEvent.click(screen.getByRole("button", { name: "Load authorized Pages" }));
  await waitFor(() => assert.ok(screen.getByText("Dedicated Review Page")));
  assert.ok(screen.getByText("/v25.0/me/accounts?fields=id,name,tasks"));
  assert.equal(view.container.textContent?.includes(secret), false);
  assert.equal(view.container.textContent?.includes("access_token"), false);
});

test("subscription control cannot be used while the separate write flag is disabled", () => {
  render(
    <MetaReviewPanel
      preflight={preflight()}
      defaultSince="2026-10-01"
      defaultUntil="2026-10-07"
      loadPages={async () => ({ ok: true, data: [], trace: null })}
      loadPermissions={async () => ({ ok: true, data: [], trace: null })}
      loadSubscription={async () => ({ ok: true, data: [], trace: null })}
      loadPosts={async () => ({ ok: true, data: [], trace: null })}
      loadInsights={async () => ({ ok: true, data: [], trace: null })}
      subscribeLeadgen={async () => ({
        ok: true,
        data: { alreadySubscribed: false, subscribedFields: ["leadgen"] },
        trace: null,
      })}
    />
  );
  const button = screen.getByRole("button", { name: "Subscribe leadgen" }) as HTMLButtonElement;
  const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
  assert.equal(button.disabled, true);
  assert.equal(checkbox.disabled, true);
  assert.ok(screen.getByText(/SA360_META_REVIEW_WRITES_ENABLED=false/));
});
