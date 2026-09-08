import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import type {
  PortalAccountActionState,
  PortalAccountProfile,
} from "@/lib/client-portal/account-profile";

import { PortalAccountView } from "./portal-account-view.tsx";

test.afterEach(() => {
  cleanup();
});

function account(overrides: Partial<PortalAccountProfile> = {}): PortalAccountProfile {
  return {
    clientDisplayName: "Northwind",
    portalDisplayName: null,
    portalLoginEmail: "alex@example.com",
    primaryNicheKeys: [],
    primaryProductTypes: [],
    status: "onboarding",
    profileComplete: false,
    readyToOrder: false,
    missingFields: ["primaryNicheKeys", "primaryProductTypes"],
    ...overrides,
  };
}

const completedAccount = account({
  portalDisplayName: "Alex",
  primaryNicheKeys: ["vet"],
  primaryProductTypes: ["aged"],
  status: "active",
  profileComplete: true,
  readyToOrder: true,
  missingFields: [],
});

async function noopSave(): Promise<PortalAccountActionState> {
  return { ok: true, account: account({ primaryNicheKeys: ["vet"] }) };
}

async function completeOk(): Promise<PortalAccountActionState> {
  return { ok: true, account: completedAccount };
}

function renderView(
  overrides: Partial<React.ComponentProps<typeof PortalAccountView>> = {}
) {
  return render(
    <PortalAccountView
      initialAccount={account()}
      loginEmail="alex@example.com"
      saveActionImpl={noopSave}
      completeActionImpl={completeOk}
      {...overrides}
    />
  );
}

const OPERATIONAL_COPY = [
  /GHL Connection/i,
  /Needs attention/i,
  /Preview data — connect live sources/i,
  /webhook/i,
  /routing/i,
  /snapshot/i,
  /workflow/i,
  /adapter/i,
  /operational-health|operational health/i,
];

test("account completion path does not call router.refresh", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const view = readFileSync(join(dir, "portal-account-view.tsx"), "utf8");
  const page = readFileSync(join(dir, "../../app/portal/account/page.tsx"), "utf8");
  assert.doesNotMatch(view, /router\.refresh|useRouter/);
  assert.doesNotMatch(page, /router\.refresh|useRouter/);
});

test("customer account page does not present operational diagnostics", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const files = [
    readFileSync(join(dir, "portal-account-view.tsx"), "utf8"),
    readFileSync(join(dir, "portal-account-panel.tsx"), "utf8"),
    readFileSync(join(dir, "portal-account-onboarding.tsx"), "utf8"),
    readFileSync(join(dir, "../../app/portal/account/page.tsx"), "utf8"),
  ];
  for (const src of files) {
    assert.doesNotMatch(src, /fetchClientTrustCenter|mapClientTrustCenter|refreshPortalAccountTrustAction/);
    assert.doesNotMatch(src, /GHL Connection|Needs attention|connect live sources for operational checks/);
    assert.doesNotMatch(src, /locationLabel/);
  }
});

function fillRequiredSetupFields() {
  fireEvent.change(screen.getByLabelText(/Lead focus/i), { target: { value: "Veteran" } });
  fireEvent.change(screen.getByLabelText(/Product types/i), { target: { value: "Aged" } });
}

test("successful finish renders completion, profile details, and a place-order CTA", async () => {
  renderView();
  fillRequiredSetupFields();
  fireEvent.click(screen.getByRole("button", { name: /Finish account setup/i }));
  await waitFor(() => {
    assert.ok(screen.getByRole("heading", { name: /Account setup complete/i }));
    assert.ok(screen.getByText("Alex"));
    assert.match(screen.getByText(/Veteran/i).textContent ?? "", /Veteran/);
    assert.ok(screen.getByText("Aged"));
  });
  const placeOrder = screen.getByRole("link", { name: "Place order" });
  assert.equal(placeOrder.getAttribute("href"), "/portal/orders/new");
  assert.match(placeOrder.className, /w-full/);
  assert.equal(screen.queryByText("Loading account"), null);
  assert.equal(screen.queryByText("Verified"), null);
  assert.equal(screen.queryByText("Account setup"), null);
  for (const pattern of OPERATIONAL_COPY) {
    assert.equal(screen.queryByText(pattern), null);
  }
  cleanup();
});

test("completed UI stays visible when a later server snapshot is still incomplete", async () => {
  const view = renderView();
  fillRequiredSetupFields();
  fireEvent.click(screen.getByRole("button", { name: /Finish account setup/i }));
  await waitFor(() => {
    assert.ok(screen.getByRole("heading", { name: /Account setup complete/i }));
    assert.ok(screen.getByText("Alex"));
  });
  view.rerender(
    <PortalAccountView
      initialAccount={account()}
      loginEmail="alex@example.com"
      saveActionImpl={noopSave}
      completeActionImpl={completeOk}
    />
  );
  assert.ok(screen.getByRole("heading", { name: /Account setup complete/i }));
  assert.equal(screen.queryByRole("button", { name: /Finish account setup/i }), null);
  assert.ok(screen.getByRole("link", { name: "Place order" }));
  assert.equal(screen.queryByText(/Loading account/i), null);
  cleanup();
});

test("failed completion keeps a safe error and does not show operational status", async () => {
  async function failComplete(): Promise<PortalAccountActionState> {
    return {
      ok: false,
      error: "Add the required account details before finishing setup.",
    };
  }
  renderView({
    completeActionImpl: failComplete,
  });
  fireEvent.click(screen.getByRole("button", { name: /Finish account setup/i }));
  await waitFor(() => {
    assert.ok(
      screen.getAllByRole("alert").some((el) => /required account details/i.test(el.textContent ?? ""))
    );
  });
  assert.ok(screen.getByRole("button", { name: /Finish account setup/i }));
  assert.equal(screen.queryByText("Verified"), null);
  cleanup();
});

test("save progress does not treat the account as complete", async () => {
  renderView();
  fireEvent.click(screen.getByRole("button", { name: /Save progress/i }));
  await waitFor(() => {
    assert.match(screen.getByRole("status").textContent ?? "", /Progress saved/i);
  });
  assert.ok(screen.getByRole("heading", { name: /Complete your account/i }));
  assert.equal(screen.queryByRole("link", { name: "Place order" }), null);
  cleanup();
});

test("account fetch failure stays on a safe unavailable state", () => {
  renderView({ accountUnavailable: true });
  assert.ok(screen.getByText(/Account details could not be loaded/i));
  assert.equal(screen.queryByRole("button", { name: /Finish account setup/i }), null);
  assert.equal(screen.queryByText(/Account status could not be loaded/i), null);
  cleanup();
});
