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
  PortalAccountTrustRefreshState,
} from "@/lib/client-portal/account-profile";
import type { PortalTrustView } from "@/lib/client-portal/map-client-trust";

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

const readyTrust: PortalTrustView = {
  generatedAt: "2026-09-04T12:00:00.000Z",
  cards: [
    {
      key: "account_setup",
      title: "Account setup",
      status: "verified",
      statusLabel: "Verified",
      summary: "Required account details are complete.",
      warnings: [],
    },
  ],
};

async function noopSave(): Promise<PortalAccountActionState> {
  return { ok: true, account: account({ primaryNicheKeys: ["vet"] }) };
}

async function completeOk(): Promise<PortalAccountActionState> {
  return { ok: true, account: completedAccount };
}

async function noopTrust(): Promise<PortalAccountTrustRefreshState> {
  return { trust: readyTrust, error: null };
}

function renderView(
  overrides: Partial<React.ComponentProps<typeof PortalAccountView>> = {}
) {
  return render(
    <PortalAccountView
      initialAccount={account()}
      loginEmail="alex@example.com"
      initialTrust={null}
      saveActionImpl={noopSave}
      completeActionImpl={completeOk}
      refreshTrustImpl={noopTrust}
      {...overrides}
    />
  );
}

test("account completion path does not call router.refresh", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const view = readFileSync(join(dir, "portal-account-view.tsx"), "utf8");
  const page = readFileSync(join(dir, "../../app/portal/account/page.tsx"), "utf8");
  assert.doesNotMatch(view, /router\.refresh|useRouter/);
  assert.doesNotMatch(page, /router\.refresh|useRouter/);
});

test("successful finish renders completion immediately and updates account details", async () => {
  renderView();
  fireEvent.click(screen.getByRole("button", { name: /Finish account setup/i }));
  await waitFor(() => {
    assert.ok(screen.getByRole("heading", { name: /Account setup complete/i }));
    assert.ok(screen.getByText("Alex"));
    assert.match(screen.getByText(/Veteran/i).textContent ?? "", /Aged/i);
  });
  assert.equal(screen.queryByText("Loading account"), null);
  await waitFor(() => {
    assert.ok(screen.getByText("Account setup"));
    assert.ok(screen.getByText("Verified"));
  });
  assert.equal(screen.queryByText("Loading account"), null);
  cleanup();
});

test("completed UI stays visible when a later server snapshot is still incomplete", async () => {
  const view = renderView();
  fireEvent.click(screen.getByRole("button", { name: /Finish account setup/i }));
  await waitFor(() => {
    assert.ok(screen.getByRole("heading", { name: /Account setup complete/i }));
    assert.ok(screen.getByText("Alex"));
  });
  view.rerender(
    <PortalAccountView
      initialAccount={account()}
      loginEmail="alex@example.com"
      initialTrust={null}
      saveActionImpl={noopSave}
      completeActionImpl={completeOk}
      refreshTrustImpl={noopTrust}
    />
  );
  assert.ok(screen.getByRole("heading", { name: /Account setup complete/i }));
  assert.equal(screen.queryByRole("button", { name: /Finish account setup/i }), null);
  assert.equal(screen.queryByText(/Loading account/i), null);
  cleanup();
});

test("failed completion does not refresh trust and keeps a safe error", async () => {
  let trustCalls = 0;
  async function failComplete(): Promise<PortalAccountActionState> {
    return {
      ok: false,
      error: "Add the required account details before finishing setup.",
    };
  }
  renderView({
    completeActionImpl: failComplete,
    refreshTrustImpl: async () => {
      trustCalls += 1;
      return { trust: readyTrust, error: null };
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /Finish account setup/i }));
  await waitFor(() => {
    assert.match(screen.getByRole("alert").textContent ?? "", /required account details/i);
  });
  assert.equal(trustCalls, 0);
  assert.ok(screen.getByRole("button", { name: /Finish account setup/i }));
  cleanup();
});

test("save progress does not treat the account as complete or refresh trust", async () => {
  let trustCalls = 0;
  renderView({
    refreshTrustImpl: async () => {
      trustCalls += 1;
      return { trust: readyTrust, error: null };
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /Save progress/i }));
  await waitFor(() => {
    assert.match(screen.getByRole("status").textContent ?? "", /Progress saved/i);
  });
  assert.equal(trustCalls, 0);
  assert.ok(screen.getByRole("heading", { name: /Complete your account/i }));
  cleanup();
});

test("trust-center fetch failure stays on a safe unavailable state", () => {
  renderView({ trustUnavailable: true });
  assert.ok(screen.getByText(/Account status could not be loaded/i));
  assert.equal(screen.queryByText("Verified"), null);
  cleanup();
});

test("account fetch failure stays on a safe unavailable state", () => {
  renderView({ accountUnavailable: true });
  assert.ok(screen.getByText(/Account details could not be loaded/i));
  assert.equal(screen.queryByRole("button", { name: /Finish account setup/i }), null);
  cleanup();
});

test("background trust refresh failure does not blank a completed account", async () => {
  renderView({
    refreshTrustImpl: async () => ({ trust: null, error: "timeout" }),
  });
  fireEvent.click(screen.getByRole("button", { name: /Finish account setup/i }));
  await waitFor(() => {
    assert.ok(screen.getByRole("heading", { name: /Account setup complete/i }));
  });
  assert.equal(screen.queryByText(/Loading account/i), null);
  await waitFor(() => {
    assert.ok(screen.getByText(/Account status could not be loaded/i));
  });
  assert.ok(screen.getByRole("heading", { name: /Account setup complete/i }));
  cleanup();
});
