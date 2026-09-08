import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePublicLeadPrefillFromFormData,
  parsePublicLeadPrefillInput,
  publicLeadPrefillNextPath,
  publicPreviewRegisterHref,
  publicSetupPathFromPrefill,
} from "./lead-request-handoff.ts";

test("new-account register/setup path retains the exact validated prefill", () => {
  const registerHref = publicPreviewRegisterHref({
    states: ["OH", "PA"],
    quantity: 250,
    freshnessId: "aged-90-plus",
  });
  const registerUrl = new URL(registerHref, "https://example.test");
  assert.equal(registerUrl.pathname, "/get-started/register");
  assert.equal(registerUrl.searchParams.get("states"), "OH,PA");
  assert.equal(registerUrl.searchParams.get("qty"), "250");
  assert.equal(registerUrl.searchParams.get("freshness"), "aged-90-plus");
  assert.equal(registerUrl.searchParams.get("niche"), "vet");
  assert.equal(registerUrl.searchParams.get("crmPackage"), null);

  const fromRegister = parsePublicLeadPrefillInput(
    Object.fromEntries(registerUrl.searchParams.entries())
  );
  const registerForm = new FormData();
  registerForm.set("agencyName", "Valley Vet");
  registerForm.set("email", "agent@example.com");
  registerForm.set("password", "long-enough-password");
  registerForm.set("confirmPassword", "long-enough-password");
  registerForm.set("states", fromRegister.states.join(","));
  registerForm.set("qty", String(fromRegister.quantity));
  registerForm.set("freshness", fromRegister.freshnessId ?? "");
  registerForm.set("niche", fromRegister.nicheKey ?? "");
  registerForm.set("crmPackage", "GHL Starter");
  registerForm.set("sku", "GHL Pro");

  const setupPath = publicSetupPathFromPrefill(parsePublicLeadPrefillFromFormData(registerForm));
  const setupUrl = new URL(setupPath, "https://example.test");
  assert.equal(setupUrl.pathname, "/get-started/setup");
  assert.equal(setupUrl.searchParams.get("states"), "OH,PA");
  assert.equal(setupUrl.searchParams.get("qty"), "250");
  assert.equal(setupUrl.searchParams.get("freshness"), "aged-90-plus");
  assert.equal(setupUrl.searchParams.get("niche"), "vet");
  assert.equal(setupUrl.searchParams.get("crmPackage"), null);
  assert.equal(setupUrl.search.includes("GHL"), false);

  const setupForm = new FormData();
  setupForm.set("clientDisplayName", "Valley Vet");
  setupForm.set("primaryNicheKeys", "vet");
  setupForm.set("primaryProductTypes", "exclusive");
  for (const [key, value] of setupUrl.searchParams.entries()) {
    setupForm.set(key, value);
  }
  setupForm.set("crmPackage", "GHL Starter");
  setupForm.set("sku", "browser-sku");

  const orderPath = publicLeadPrefillNextPath(parsePublicLeadPrefillFromFormData(setupForm));
  const orderUrl = new URL(orderPath, "https://example.test");
  assert.equal(orderUrl.pathname, "/portal/orders/new");
  assert.equal(orderUrl.searchParams.get("states"), "OH,PA");
  assert.equal(orderUrl.searchParams.get("qty"), "250");
  assert.equal(orderUrl.searchParams.get("freshness"), "aged-90-plus");
  assert.equal(orderUrl.searchParams.get("niche"), "vet");
  assert.equal(orderUrl.searchParams.get("crmPackage"), null);
  assert.equal(orderUrl.searchParams.get("sku"), null);
  assert.equal(orderUrl.search.includes("GHL"), false);
});
