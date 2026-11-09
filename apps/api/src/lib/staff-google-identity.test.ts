import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeStaffSessionPrincipal,
  resolveProvisionedStaffPrincipal,
  type ProvisionedStaffPrincipal,
} from "./staff-google-identity.js";

const PRINCIPAL = "c123456789012345678901234";
const GOOGLE_SUB = "102938475610293847561";

function principal(overrides: Partial<ProvisionedStaffPrincipal> = {}): ProvisionedStaffPrincipal {
  return {
    id: PRINCIPAL,
    email: "person@example.com",
    status: "active",
    provider: "google",
    providerSubject: GOOGLE_SUB,
    disabledAt: null,
    ...overrides,
  };
}

const identity = { sub: GOOGLE_SUB, email: "person@example.com", emailVerified: true };

test("a verified google subject resolves only an already bound active principal", () => {
  const resolved = resolveProvisionedStaffPrincipal(identity, principal());
  assert.deepEqual(resolved, { ok: true, staffPrincipalId: PRINCIPAL });
  assert.equal("permission" in resolved, false);
});

function denial(result: { ok: boolean; code?: string }): string {
  assert.equal(result.ok, false);
  return result.code ?? "";
}

test("unknown, disabled, unbound, conflicting, and unverified identities are denied", () => {
  assert.equal(denial(resolveProvisionedStaffPrincipal(identity, null)), "unknown");
  assert.equal(denial(resolveProvisionedStaffPrincipal(identity, principal({ status: "disabled", disabledAt: "2026-01-01" }))), "disabled");
  assert.equal(denial(resolveProvisionedStaffPrincipal(identity, principal({ providerSubject: null }))), "unbound");
  assert.equal(
    denial(resolveProvisionedStaffPrincipal(identity, principal({ providerSubject: "99999999999999999999" }))),
    "conflicting_sub"
  );
  assert.equal(denial(resolveProvisionedStaffPrincipal({ ...identity, emailVerified: false }, principal())), "unverified_email");
  assert.equal(
    denial(resolveProvisionedStaffPrincipal({ ...identity, email: "other@example.com" }, principal({ providerSubject: null }))),
    "unbound"
  );
});

test("a live session is denied when the principal is disabled or the subject no longer matches", () => {
  const session = { staffPrincipalId: PRINCIPAL, googleSub: GOOGLE_SUB };
  assert.deepEqual(authorizeStaffSessionPrincipal(session, principal()), { ok: true, staffPrincipalId: PRINCIPAL });
  assert.equal(denial(authorizeStaffSessionPrincipal(session, null)), "missing");
  assert.equal(denial(authorizeStaffSessionPrincipal(session, principal({ status: "disabled", disabledAt: "2026-01-01" }))), "disabled");
  assert.equal(denial(authorizeStaffSessionPrincipal(session, principal({ providerSubject: null }))), "unbound");
  assert.equal(
    denial(authorizeStaffSessionPrincipal(session, principal({ providerSubject: "99999999999999999999" }))),
    "conflicting_sub"
  );
});
