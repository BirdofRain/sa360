import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import type { PortalAccountActionState, PortalAccountProfile } from "@/lib/client-portal/account-profile";
import { parsePublicLeadPrefillInput } from "@/lib/public-site/lead-request-handoff";

import { AgedVetSetupForm } from "./aged-vet-setup-form.tsx";

async function noopAction(): Promise<PortalAccountActionState> {
  return { ok: true };
}

const account: PortalAccountProfile = {
  clientDisplayName: "Valley Vet",
  portalDisplayName: null,
  portalLoginEmail: "agent@example.com",
  primaryNicheKeys: ["vet"],
  primaryProductTypes: [],
  status: "onboarding",
  profileComplete: false,
  readyToOrder: false,
  missingFields: ["primaryProductTypes"],
};

test("setup form keeps allowlisted prefill fields and never posts a CRM SKU", () => {
  render(
    <AgedVetSetupForm
      initialAccount={account}
      loginEmail="agent@example.com"
      saveActionImpl={noopAction}
      completeActionImpl={noopAction}
      initialPrefill={parsePublicLeadPrefillInput({
        states: "TX,FL",
        qty: "100",
        freshness: "aged-30-90",
        niche: "vet",
        sku: "GHL Pro",
      })}
    />
  );
  assert.ok(screen.getByRole("heading", { name: /Finish your account/i }));
  assert.ok(screen.getByRole("button", { name: /Finish setup and continue/i }));
  assert.equal((document.querySelector("input[name='states']") as HTMLInputElement | null)?.value, "TX,FL");
  assert.equal((document.querySelector("input[name='qty']") as HTMLInputElement | null)?.value, "100");
  assert.equal(
    (document.querySelector("input[name='freshness']") as HTMLInputElement | null)?.value,
    "aged-30-90"
  );
  assert.equal((document.querySelector("input[name='niche']") as HTMLInputElement | null)?.value, "vet");
  assert.equal(document.querySelector("input[name='crmPackage']"), null);
  assert.equal(document.querySelector("input[name='sku']"), null);
  cleanup();
});
