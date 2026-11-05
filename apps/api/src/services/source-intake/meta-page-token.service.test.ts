import assert from "node:assert/strict";
import test from "node:test";

import { encryptMetaToken, metaTokenFingerprint } from "../../lib/meta-token-encryption.js";
import { resolveMetaCapturePageToken } from "./meta-page-token.service.js";

const KEY = "test-meta-token-key-not-a-real-secret";
const PAGE_A = "102720336121632";
const PAGE_B = "102720336121633";
const TOKEN_A = "EAAB-page-a-token-value-not-real";
const TOKEN_B = "EAAB-page-b-token-value-not-real";

function config(overrides: { accessToken?: string | null; accessTokenPageId?: string | null; unboundPageTokenEnabled?: boolean } = {}) {
  return {
    accessToken: overrides.accessToken === undefined ? "EAAB-env-token-value-not-real" : overrides.accessToken,
    accessTokenPageId: overrides.accessTokenPageId ?? null,
    unboundPageTokenEnabled: overrides.unboundPageTokenEnabled ?? false,
  };
}

test("stored Page tokens are selected per Page and a disabled grant does not fall through", async () => {
  const saved = process.env.META_TOKEN_ENCRYPTION_KEY;
  process.env.META_TOKEN_ENCRYPTION_KEY = KEY;
  try {
    const grants = new Map([
      [
        PAGE_A,
        {
          pageId: PAGE_A,
          captureEnabled: true,
          credential: {
            id: "cred_a",
            status: "active" as const,
            expiresAt: null,
            scopes: ["leads_retrieval", "pages_manage_ads", "pages_read_engagement"],
            tokenCiphertext: encryptMetaToken(TOKEN_A),
            tokenFingerprint: metaTokenFingerprint(TOKEN_A),
            lastDiagnostic: null,
          },
        },
      ],
      [
        PAGE_B,
        {
          pageId: PAGE_B,
          captureEnabled: false,
          credential: {
            id: "cred_b",
            status: "active" as const,
            expiresAt: null,
            scopes: ["leads_retrieval", "pages_manage_ads", "pages_read_engagement"],
            tokenCiphertext: encryptMetaToken(TOKEN_B),
            tokenFingerprint: metaTokenFingerprint(TOKEN_B),
            lastDiagnostic: null,
          },
        },
      ],
    ]);
    const findGrantImpl = async (pageId: string) => grants.get(pageId) ?? null;
    const selected = await resolveMetaCapturePageToken(PAGE_A, config({ unboundPageTokenEnabled: true }), {
      findGrantImpl,
    });
    assert.equal(selected.ok, true);
    if (selected.ok) {
      assert.equal(selected.accessToken, TOKEN_A);
      assert.notEqual(selected.accessToken, TOKEN_B);
      assert.equal(selected.source, "stored_page");
      assert.equal(selected.scope, "page_bound");
      assert.equal(selected.credentialId, "cred_a");
    }
    const blocked = await resolveMetaCapturePageToken(PAGE_B, config({ unboundPageTokenEnabled: true }), {
      findGrantImpl,
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.reason, "capture_not_allowlisted");
      assert.equal(blocked.diagnostic.includes(TOKEN_A), false);
      assert.equal(blocked.diagnostic.includes(TOKEN_B), false);
    }
  } finally {
    if (saved === undefined) delete process.env.META_TOKEN_ENCRYPTION_KEY;
    else process.env.META_TOKEN_ENCRYPTION_KEY = saved;
  }
});

test("unknown Pages, expiry, and missing scopes fail closed without using another token", async () => {
  const saved = process.env.META_TOKEN_ENCRYPTION_KEY;
  process.env.META_TOKEN_ENCRYPTION_KEY = KEY;
  try {
    const expired = await resolveMetaCapturePageToken(
      PAGE_A,
      config(),
      {
        findGrantImpl: async () => ({
          pageId: PAGE_A,
          captureEnabled: true,
          credential: {
            id: "cred_exp",
            status: "active",
            expiresAt: new Date("2020-01-01T00:00:00.000Z"),
            scopes: ["leads_retrieval", "pages_manage_ads", "pages_read_engagement"],
            tokenCiphertext: encryptMetaToken(TOKEN_A),
            tokenFingerprint: metaTokenFingerprint(TOKEN_A),
            lastDiagnostic: null,
          },
        }),
      }
    );
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.reason, "token_expired");

    const missingScope = await resolveMetaCapturePageToken(PAGE_A, config(), {
      findGrantImpl: async () => ({
        pageId: PAGE_A,
        captureEnabled: true,
        credential: {
          id: "cred_scope",
          status: "active",
          expiresAt: null,
          scopes: ["pages_show_list"],
          tokenCiphertext: encryptMetaToken(TOKEN_A),
          tokenFingerprint: metaTokenFingerprint(TOKEN_A),
          lastDiagnostic: null,
        },
      }),
    });
    assert.equal(missingScope.ok, false);
    if (!missingScope.ok) {
      assert.equal(missingScope.reason, "missing_permission");
      assert.match(missingScope.diagnostic, /leads_retrieval/);
      assert.equal(missingScope.diagnostic.includes(TOKEN_A), false);
    }

    let lookups = 0;
    const unknown = await resolveMetaCapturePageToken("200000000000099", config(), {
      findGrantImpl: async () => {
        lookups += 1;
        return null;
      },
    });
    assert.equal(lookups, 1);
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.reason, "unbound_token_disabled");

    const nonNumeric = await resolveMetaCapturePageToken("page_pilot", config({ accessTokenPageId: "page_pilot" }), {
      findGrantImpl: async () => {
        throw new Error("database must not be consulted for a non-numeric fixture Page id");
      },
    });
    assert.equal(nonNumeric.ok, true);
    if (nonNumeric.ok) assert.equal(nonNumeric.source, "env_page");
  } finally {
    if (saved === undefined) delete process.env.META_TOKEN_ENCRYPTION_KEY;
    else process.env.META_TOKEN_ENCRYPTION_KEY = saved;
  }
});

test("enabling a test Page does not let the pilot env token fetch the pilot or the test Page", async () => {
  const saved = process.env.META_TOKEN_ENCRYPTION_KEY;
  process.env.META_TOKEN_ENCRYPTION_KEY = KEY;
  const pilotPage = PAGE_A;
  const testPageId = PAGE_B;
  const envToken = "EAAB-pilot-env-token-value-not-real";
  try {
    const grants = new Map([
      [
        testPageId,
        {
          pageId: testPageId,
          captureEnabled: true,
          credential: {
            id: "cred_test",
            status: "active" as const,
            expiresAt: null,
            scopes: ["leads_retrieval", "pages_manage_ads", "pages_read_engagement"],
            tokenCiphertext: encryptMetaToken(TOKEN_B),
            tokenFingerprint: metaTokenFingerprint(TOKEN_B),
            lastDiagnostic: null,
          },
        },
      ],
      [
        pilotPage,
        {
          pageId: pilotPage,
          captureEnabled: false,
          credential: {
            id: "cred_pilot_hold",
            status: "active" as const,
            expiresAt: null,
            scopes: [] as string[],
            tokenCiphertext: encryptMetaToken(TOKEN_A),
            tokenFingerprint: metaTokenFingerprint(TOKEN_A),
            lastDiagnostic: null,
          },
        },
      ],
    ]);
    const bound = config({
      accessToken: envToken,
      accessTokenPageId: pilotPage,
      unboundPageTokenEnabled: false,
    });
    const findGrantImpl = async (pageId: string) => grants.get(pageId) ?? null;

    const testPage = await resolveMetaCapturePageToken(testPageId, bound, { findGrantImpl });
    assert.equal(testPage.ok, true);
    if (testPage.ok) {
      assert.equal(testPage.accessToken, TOKEN_B);
      assert.equal(testPage.source, "stored_page");
      assert.notEqual(testPage.accessToken, envToken);
    }

    const pilot = await resolveMetaCapturePageToken(pilotPage, bound, { findGrantImpl });
    assert.equal(pilot.ok, false);
    if (!pilot.ok) {
      assert.equal(pilot.reason, "capture_not_allowlisted");
      assert.equal(pilot.diagnostic.includes(envToken), false);
      assert.equal(pilot.diagnostic.includes(TOKEN_A), false);
    }

    const withoutHold = await resolveMetaCapturePageToken(pilotPage, bound, {
      findGrantImpl: async () => null,
    });
    assert.equal(withoutHold.ok, true);
    if (withoutHold.ok) {
      assert.equal(withoutHold.source, "env_page");
      assert.equal(withoutHold.accessToken, envToken);
    }
  } finally {
    if (saved === undefined) delete process.env.META_TOKEN_ENCRYPTION_KEY;
    else process.env.META_TOKEN_ENCRYPTION_KEY = saved;
  }
});
