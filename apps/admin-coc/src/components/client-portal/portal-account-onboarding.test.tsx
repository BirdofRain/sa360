import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import {
  ACCOUNT_SETUP_NICHE_PLACEHOLDER,
  ACCOUNT_SETUP_PRODUCT_PLACEHOLDER,
  type PortalAccountActionState,
  type PortalAccountProfile,
} from "@/lib/client-portal/account-profile";

import { PortalAccountOnboarding } from "./portal-account-onboarding.tsx";

test.afterEach(() => {
  cleanup();
});

async function noopAction(): Promise<PortalAccountActionState> {
  return { ok: true };
}

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
  primaryNicheKeys: ["vet"],
  primaryProductTypes: ["aged"],
  status: "active",
  profileComplete: true,
  readyToOrder: true,
  missingFields: [],
});

test("incomplete onboarding shows required fields and stacked mobile actions", () => {
  render(
    <PortalAccountOnboarding
      initialAccount={account()}
      saveActionImpl={noopAction}
      completeActionImpl={noopAction}
    />
  );
  assert.ok(screen.getByRole("heading", { name: /Complete your account/i }));
  const name = screen.getByLabelText(/Account name/i);
  const niches = screen.getByLabelText(/Lead focus/i) as HTMLInputElement;
  const products = screen.getByLabelText(/Product types/i) as HTMLInputElement;
  assert.equal(name.getAttribute("aria-required"), "true");
  assert.equal(niches.getAttribute("aria-required"), "true");
  assert.equal(products.getAttribute("aria-required"), "true");
  const finish = screen.getByRole("button", { name: /Finish account setup/i });
  const save = screen.getByRole("button", { name: /Save progress/i });
  assert.match(finish.className, /w-full/);
  assert.match(save.className, /w-full/);
  assert.match(finish.className, /min-h-10/);
  cleanup();
});

test("Veteran / Trucker and Final Expense / Aged are placeholders, not values", () => {
  render(
    <PortalAccountOnboarding
      initialAccount={account()}
      saveActionImpl={noopAction}
      completeActionImpl={noopAction}
    />
  );
  const niches = screen.getByLabelText(/Lead focus/i) as HTMLInputElement;
  const products = screen.getByLabelText(/Product types/i) as HTMLInputElement;
  assert.equal(niches.value, "");
  assert.equal(products.value, "");
  assert.equal(niches.getAttribute("placeholder"), ACCOUNT_SETUP_NICHE_PLACEHOLDER);
  assert.equal(products.getAttribute("placeholder"), ACCOUNT_SETUP_PRODUCT_PLACEHOLDER);
  const exampleHelp = screen.getAllByText(/Examples only/);
  assert.equal(exampleHelp.length, 2);
  assert.match(exampleHelp[0]?.textContent ?? "", /type your own/i);
  assert.ok(screen.getByPlaceholderText(ACCOUNT_SETUP_NICHE_PLACEHOLDER));
  assert.ok(screen.getByPlaceholderText(ACCOUNT_SETUP_PRODUCT_PLACEHOLDER));
  cleanup();
});

test("finish with untouched placeholders shows required-field UX and does not submit examples", async () => {
  let completeCalls = 0;
  const submitted: string[] = [];
  async function completeAction(
    _prev: PortalAccountActionState | undefined,
    formData: FormData
  ): Promise<PortalAccountActionState> {
    completeCalls += 1;
    submitted.push(String(formData.get("primaryNicheKeys") ?? ""));
    submitted.push(String(formData.get("primaryProductTypes") ?? ""));
    return { ok: true, account: completedAccount };
  }
  render(
    <PortalAccountOnboarding
      initialAccount={account()}
      saveActionImpl={noopAction}
      completeActionImpl={completeAction}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /Finish account setup/i }));
  await waitFor(() => {
    assert.ok(screen.getByText(/Add at least one lead focus/i));
    assert.ok(screen.getByText(/Add at least one product type/i));
  });
  assert.ok(
    screen.getAllByRole("alert").some((el) => /required account details/i.test(el.textContent ?? ""))
  );
  assert.equal(completeCalls, 0);
  assert.deepEqual(submitted, []);
  assert.ok(screen.getByRole("heading", { name: /Complete your account/i }));
  cleanup();
});

test("completed account shows ready-to-order copy and hides the setup form", () => {
  render(
    <PortalAccountOnboarding
      initialAccount={completedAccount}
      saveActionImpl={noopAction}
      completeActionImpl={noopAction}
    />
  );
  assert.ok(screen.getByRole("heading", { name: /Account setup complete/i }));
  assert.ok(screen.getByText(/You’re ready to place an order/i));
  assert.equal(screen.queryByRole("button", { name: /Finish account setup/i }), null);
  assert.equal(screen.getByRole("status").getAttribute("aria-labelledby"), "account-setup-complete-title");
  const placeOrder = screen.getByRole("link", { name: "Place order" });
  assert.equal(placeOrder.getAttribute("href"), "/portal/orders/new");
  assert.match(placeOrder.className, /w-full/);
  assert.match(placeOrder.className, /sm:w-auto/);
  cleanup();
});

function fillRequiredSetupFields() {
  fireEvent.change(screen.getByLabelText(/Lead focus/i), { target: { value: "Veteran" } });
  fireEvent.change(screen.getByLabelText(/Product types/i), { target: { value: "Aged" } });
}

test("successful finish shows pending copy then completion without invoking a route skeleton", async () => {
  let resolveComplete!: (value: PortalAccountActionState) => void;
  const completeAction = () =>
    new Promise<PortalAccountActionState>((resolve) => {
      resolveComplete = resolve;
    });
  render(
    <PortalAccountOnboarding
      initialAccount={account()}
      saveActionImpl={noopAction}
      completeActionImpl={completeAction}
    />
  );
  fillRequiredSetupFields();
  fireEvent.click(screen.getByRole("button", { name: /Finish account setup/i }));
  await waitFor(() => {
    assert.ok(screen.getByRole("button", { name: /Finishing setup/i }));
  });
  assert.equal(screen.queryByText(/Loading account/i), null);
  resolveComplete({ ok: true, account: completedAccount });
  await waitFor(() => {
    assert.ok(screen.getByRole("heading", { name: /Account setup complete/i }));
  });
  assert.equal(screen.queryByText(/Loading account/i), null);
  assert.equal(screen.queryByRole("button", { name: /Finish account setup/i }), null);
  assert.equal(screen.getByRole("link", { name: "Place order" }).getAttribute("href"), "/portal/orders/new");
  cleanup();
});

test("failed completion keeps the form and shows a safe error", async () => {
  async function failComplete(): Promise<PortalAccountActionState> {
    return {
      ok: false,
      error: "Add the required account details before finishing setup.",
      missingFields: ["primaryNicheKeys"],
    };
  }
  render(
    <PortalAccountOnboarding
      initialAccount={account()}
      saveActionImpl={noopAction}
      completeActionImpl={failComplete}
    />
  );
  fillRequiredSetupFields();
  fireEvent.click(screen.getByRole("button", { name: /Finish account setup/i }));
  await waitFor(() => {
    assert.ok(screen.getByText(/Add the required account details before finishing setup/i));
  });
  assert.ok(screen.getByRole("heading", { name: /Complete your account/i }));
  assert.ok(screen.getByRole("button", { name: /Finish account setup/i }));
  cleanup();
});

test("save progress keeps the form and confirms the draft was stored", async () => {
  async function saveOk(): Promise<PortalAccountActionState> {
    return { ok: true, account: account({ primaryNicheKeys: ["vet"] }) };
  }
  render(
    <PortalAccountOnboarding
      initialAccount={account()}
      saveActionImpl={saveOk}
      completeActionImpl={noopAction}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /Save progress/i }));
  await waitFor(() => {
    assert.match(screen.getByRole("status").textContent ?? "", /Progress saved/i);
  });
  assert.ok(screen.getByRole("heading", { name: /Complete your account/i }));
  assert.ok(screen.getByRole("button", { name: /Finish account setup/i }));
  cleanup();
});
