import assert from "node:assert/strict";
import { test } from "node:test";

import { getAdminApiKey } from "./admin-auth.js";
import {
  PROVENANCE_AUDIT_MIN_KEY_LENGTH,
  auditKeyIsDistinctFromAdminKeys,
  auditKeyIsUsable,
  authorizeProvenanceImpactAudit,
  credentialsMatch,
  isProvenanceImpactAuditEnabled,
  timingSafeTokenEqual,
} from "./provenance-audit-auth.js";

const AUDIT_KEY = "audit-only-key-0123456789";
const ADMIN_KEY = "admin-key-0123456789abc";

function saveEnv() {
  return {
    flag: process.env.SA360_PROVENANCE_AUDIT_ENABLED,
    audit: process.env.SA360_AUDIT_READONLY_KEY,
    admin: process.env.ADMIN_API_KEY,
    alias: process.env.SA360_ADMIN_KEY,
  };
}

function restoreEnv(prev: ReturnType<typeof saveEnv>) {
  const assign = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  assign("SA360_PROVENANCE_AUDIT_ENABLED", prev.flag);
  assign("SA360_AUDIT_READONLY_KEY", prev.audit);
  assign("ADMIN_API_KEY", prev.admin);
  assign("SA360_ADMIN_KEY", prev.alias);
}

test("provenance audit flag is exact true and defaults off", () => {
  const prev = process.env.SA360_PROVENANCE_AUDIT_ENABLED;
  delete process.env.SA360_PROVENANCE_AUDIT_ENABLED;
  assert.equal(isProvenanceImpactAuditEnabled(), false);
  process.env.SA360_PROVENANCE_AUDIT_ENABLED = "TRUE";
  assert.equal(isProvenanceImpactAuditEnabled(), false);
  process.env.SA360_PROVENANCE_AUDIT_ENABLED = "1";
  assert.equal(isProvenanceImpactAuditEnabled(), false);
  process.env.SA360_PROVENANCE_AUDIT_ENABLED = "true";
  assert.equal(isProvenanceImpactAuditEnabled(), true);
  if (prev === undefined) delete process.env.SA360_PROVENANCE_AUDIT_ENABLED;
  else process.env.SA360_PROVENANCE_AUDIT_ENABLED = prev;
});

test("token comparison is fixed-length and does not throw on unequal lengths", () => {
  assert.equal(timingSafeTokenEqual("short", "short"), true);
  assert.equal(timingSafeTokenEqual("short", "a-much-longer-secret-value"), false);
  assert.equal(timingSafeTokenEqual("", "secret"), false);
  assert.equal(credentialsMatch("secret-value", undefined), false);
  assert.equal(credentialsMatch("secret-value", "secret-value"), true);
  assert.equal(credentialsMatch("secret-value", " other "), false);
});

test("audit key must be long and distinct from every admin key", () => {
  const prev = saveEnv();
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  process.env.SA360_ADMIN_KEY = "alias-admin-key-0123456789";
  delete process.env.SA360_AUDIT_READONLY_KEY;
  assert.equal(auditKeyIsUsable(undefined), false);
  assert.equal(auditKeyIsUsable("short-key"), false);
  assert.equal(auditKeyIsUsable(ADMIN_KEY), false);
  assert.equal(auditKeyIsUsable("alias-admin-key-0123456789"), false);
  assert.equal(auditKeyIsDistinctFromAdminKeys(AUDIT_KEY), true);
  assert.equal(auditKeyIsUsable(AUDIT_KEY), true);
  assert.ok(AUDIT_KEY.length >= PROVENANCE_AUDIT_MIN_KEY_LENGTH);
  restoreEnv(prev);
});

test("audit header authorizes only when the key is usable, and admin header stays separate", async () => {
  const prev = saveEnv();
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  process.env.SA360_AUDIT_READONLY_KEY = AUDIT_KEY;
  const sent: Array<{ status: number; body: unknown }> = [];
  const reply = {
    status(code: number) {
      return {
        send(body: unknown) {
          sent.push({ status: code, body });
        },
      };
    },
  };
  const request = (headers: Record<string, string>) =>
    ({ headers }) as unknown as Parameters<typeof authorizeProvenanceImpactAudit>[0];

  try {
    assert.equal(
      await authorizeProvenanceImpactAudit(
        request({ "x-sa360-provenance-audit-key": AUDIT_KEY }),
        reply as never
      ),
      true
    );
    assert.equal(
      await authorizeProvenanceImpactAudit(request({ "x-sa360-admin-key": ADMIN_KEY }), reply as never),
      true
    );
    assert.equal(
      await authorizeProvenanceImpactAudit(
        request({ "x-sa360-admin-key": AUDIT_KEY }),
        reply as never
      ),
      false
    );
    assert.equal(
      await authorizeProvenanceImpactAudit(
        request({ "x-sa360-provenance-audit-key": ADMIN_KEY }),
        reply as never
      ),
      false
    );
    assert.equal(sent.at(-1)?.status, 401);
    assert.equal(getAdminApiKey(), ADMIN_KEY);

    process.env.SA360_AUDIT_READONLY_KEY = ADMIN_KEY;
    sent.length = 0;
    assert.equal(
      await authorizeProvenanceImpactAudit(
        request({ "x-sa360-provenance-audit-key": ADMIN_KEY }),
        reply as never
      ),
      false
    );
    assert.equal(sent.at(-1)?.status, 401);
    assert.equal(
      await authorizeProvenanceImpactAudit(request({ "x-sa360-admin-key": ADMIN_KEY }), reply as never),
      true
    );
  } finally {
    restoreEnv(prev);
  }
});
