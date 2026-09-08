import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

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
