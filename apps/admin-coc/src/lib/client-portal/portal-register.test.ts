import assert from "node:assert/strict";
import test from "node:test";

import {
  PORTAL_REGISTER_GENERIC_ERROR,
  portalSessionFromRegisterResponse,
  publicRegisterErrorCopy,
} from "./portal-register.ts";

const context = {
  clientAccountId: "avl01010101010101010101",
  clientDisplayName: "Hebda Insurance",
  portalDisplayName: "Hebda Insurance",
  portalLoginEmail: "agent@example.com",
  portalEnabled: true,
  locationName: null,
  subaccountIdGhl: null,
  primaryNicheKeys: ["vet"],
  primaryProductTypes: [],
  hasPortalPassword: true,
  portalSessionEpoch: 0,
};

test("session establishment uses the server-issued tenant id, not a browser id", () => {
  const session = portalSessionFromRegisterResponse({
    portalSessionEpoch: 0,
    status: "onboarding",
    context,
  });
  assert.equal(session?.clientAccountId, "avl01010101010101010101");
  assert.equal(session?.portalLoginEmail, "agent@example.com");
  assert.equal(session?.portalSessionEpoch, 0);
  assert.equal(
    portalSessionFromRegisterResponse({
      portalSessionEpoch: 0,
      status: "onboarding",
      context: { ...context, clientAccountId: "" },
    }),
    null
  );
  assert.equal(
    portalSessionFromRegisterResponse({
      portalSessionEpoch: 0,
      status: "onboarding",
      context: { ...context, portalEnabled: false },
    }),
    null
  );
});

test("duplicate and failed registration share generic non-enumerating copy", () => {
  assert.equal(publicRegisterErrorCopy("We could not create your account. If you already have one, sign in.", 400), PORTAL_REGISTER_GENERIC_ERROR);
  assert.equal(publicRegisterErrorCopy("email already exists", 400), PORTAL_REGISTER_GENERIC_ERROR);
  assert.equal(publicRegisterErrorCopy(undefined, 400).toLowerCase().includes("email"), false);
  assert.match(publicRegisterErrorCopy("Too many attempts. Try again later.", 429), /try again later/i);
});
