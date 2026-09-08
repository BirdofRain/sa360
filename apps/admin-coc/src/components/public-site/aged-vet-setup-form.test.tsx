import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { AgedVetSetupForm } from "./aged-vet-setup-form.tsx";

test("public setup form reuses account fields without payment or admin controls", () => {
  render(
    <AgedVetSetupForm
      initialAccount={{
        clientDisplayName: "Hebda Insurance",
        portalDisplayName: "Hebda",
        portalLoginEmail: "agent@example.com",
        primaryNicheKeys: ["vet"],
        primaryProductTypes: [],
        status: "onboarding",
        profileComplete: false,
        readyToOrder: false,
        missingFields: ["primaryProductTypes"],
      }}
      loginEmail="agent@example.com"
    />
  );
  assert.ok(screen.getByRole("heading", { name: /Finish your account/i }));
  assert.ok(screen.getByText(/Signed in as agent@example.com/));
  assert.ok(screen.getByLabelText(/Account name/i));
  assert.ok(screen.getByLabelText(/Lead focus/i));
  assert.ok(screen.getByLabelText(/Product types/i));
  assert.ok(screen.getByRole("button", { name: /Finish setup and continue/i }));
  assert.equal(screen.queryByText(/Stripe/i), null);
  assert.equal(screen.queryByText(/Approve/i), null);
  assert.equal(document.querySelector("input[name='clientAccountId']"), null);
  cleanup();
});
