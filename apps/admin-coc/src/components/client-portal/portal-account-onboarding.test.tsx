import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import type { PortalAccountProfile } from "@/lib/client-portal/account-profile";

import { PortalAccountOnboarding } from "./portal-account-onboarding.tsx";

async function noopAction(): Promise<{ ok: boolean }> {
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
  const niches = screen.getByLabelText(/Lead focus/i);
  const products = screen.getByLabelText(/Product types/i);
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

test("completed account shows ready-to-order copy and hides the setup form", () => {
  render(
    <PortalAccountOnboarding
      initialAccount={account({
        primaryNicheKeys: ["vet"],
        primaryProductTypes: ["aged"],
        status: "active",
        profileComplete: true,
        readyToOrder: true,
        missingFields: [],
      })}
      saveActionImpl={noopAction}
      completeActionImpl={noopAction}
    />
  );
  assert.ok(screen.getByRole("heading", { name: /Account setup complete/i }));
  assert.ok(screen.getByText(/You’re ready to place an order/i));
  assert.equal(screen.queryByRole("button", { name: /Finish account setup/i }), null);
  cleanup();
});
