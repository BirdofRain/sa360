import test from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import { PORTAL_FORGOT_PASSWORD_LINK, PORTAL_FORGOT_PASSWORD_PATH } from "@/lib/client-portal/portal-password-reset-flow";
import { PUBLIC_LEAD_PREFILL_STORAGE_KEY } from "@/lib/public-site/lead-request-handoff";

import { PortalLoginForm } from "./portal-login-form.tsx";

test("login form exposes Forgot password? without account or tenant ids", () => {
  sessionStorage.clear();
  render(<PortalLoginForm next="/portal" />);
  const link = screen.getByRole("link", { name: PORTAL_FORGOT_PASSWORD_LINK });
  assert.equal(link.getAttribute("href"), PORTAL_FORGOT_PASSWORD_PATH);
  assert.equal(screen.queryByText(/acct_/), null);
  assert.equal(screen.queryByText(/clientAccountId/i), null);
  assert.equal(screen.queryByText(/shared/i), null);
  const create = screen.getByRole("link", { name: "Create one" });
  assert.equal(create.getAttribute("href"), "/get-started/register");
  cleanup();
});

test("generic dashboard next upgrades from stored AgedVet preview", async () => {
  sessionStorage.setItem(
    PUBLIC_LEAD_PREFILL_STORAGE_KEY,
    JSON.stringify({ v: 1, states: ["TX"], quantity: 50, freshnessId: "fresh" })
  );
  render(<PortalLoginForm next="/portal" />);
  await waitFor(() => {
    const hidden = document.querySelector('input[name="next"]') as HTMLInputElement | null;
    assert.ok(hidden);
    const nextUrl = new URL(hidden.value, "https://example.test");
    assert.equal(nextUrl.pathname, "/portal/orders/new");
    assert.equal(nextUrl.searchParams.get("qty"), "50");
    assert.equal(nextUrl.searchParams.get("freshness"), "fresh");
    assert.equal(nextUrl.searchParams.get("niche"), "vet");
  });
  sessionStorage.removeItem(PUBLIC_LEAD_PREFILL_STORAGE_KEY);
  cleanup();
});

