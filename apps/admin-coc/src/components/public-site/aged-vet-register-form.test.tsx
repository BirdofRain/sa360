import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { parsePublicLeadPrefillInput } from "@/lib/public-site/lead-request-handoff";

import { AgedVetRegisterForm } from "./aged-vet-register-form.tsx";

test("public register form has no browser-supplied tenant or payment fields", () => {
  render(<AgedVetRegisterForm />);
  assert.ok(screen.getByRole("heading", { name: /Open your Aged Vet Leads account/i }));
  assert.ok(screen.getByLabelText(/Agency or business name/i));
  assert.ok(screen.getByLabelText(/Work email/i));
  assert.ok(screen.getByLabelText(/^Password$/i));
  assert.ok(screen.getByLabelText(/Confirm password/i));
  assert.ok(screen.getByRole("button", { name: "Create account" }));
  assert.equal(screen.getByRole("link", { name: "Sign in" }).getAttribute("href"), "/portal/login");
  assert.equal(screen.queryByLabelText(/clientAccountId/i), null);
  assert.equal(document.querySelector("input[name='clientAccountId']"), null);
  assert.equal(document.querySelector("input[name='status']"), null);
  assert.equal(screen.queryByText(/Stripe/i), null);
  cleanup();
});

test("register form carries allowlisted prefill hidden fields and drops CRM", () => {
  render(
    <AgedVetRegisterForm
      initialPrefill={parsePublicLeadPrefillInput({
        states: "OH,PA",
        qty: "250",
        freshness: "aged-90-plus",
        niche: "vet",
        crmPackage: "GHL Starter",
      })}
    />
  );
  assert.equal((document.querySelector("input[name='states']") as HTMLInputElement | null)?.value, "OH,PA");
  assert.equal((document.querySelector("input[name='qty']") as HTMLInputElement | null)?.value, "250");
  assert.equal(
    (document.querySelector("input[name='freshness']") as HTMLInputElement | null)?.value,
    "aged-90-plus"
  );
  assert.equal((document.querySelector("input[name='niche']") as HTMLInputElement | null)?.value, "vet");
  assert.equal(document.querySelector("input[name='crmPackage']"), null);
  const signIn = screen.getByRole("link", { name: "Sign in" }).getAttribute("href") ?? "";
  const next = new URL(signIn, "https://example.test").searchParams.get("next");
  assert.ok(next);
  const orderUrl = new URL(next, "https://example.test");
  assert.equal(orderUrl.pathname, "/portal/orders/new");
  assert.equal(orderUrl.searchParams.get("freshness"), "aged-90-plus");
  cleanup();
});
