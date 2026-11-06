import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { adminMetaCaptureRoutes } from "./admin-meta-capture.js";
import { parseMetaCandidateRegistry } from "../services/source-intake/meta-capture-inventory.service.js";
import type { MetaPageCredentialPublic } from "../services/source-intake/meta-page-token.service.js";

const ADMIN_KEY = "meta-capture-admin";
const LEAK = "EAAB-LEAKED-TOKEN-VALUE-NOT-REAL";

function publicCredential(): MetaPageCredentialPublic {
  return {
    id: "cred_1",
    kind: "page_access_token",
    label: "Page A",
    tokenFingerprint: "abc123def456",
    tokenVersion: 1,
    appId: "1641287293781686",
    expiresAt: null,
    scopes: ["leads_retrieval"],
    status: "active",
    lastCheckedAt: null,
    lastDiagnostic: null,
    pages: [{ pageId: "102720336121632", pageName: "Pilot", captureEnabled: false }],
  };
}

async function withAdmin<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
  }
}

test("meta capture admin routes require the admin key and never echo a token", async () => {
  await withAdmin(async () => {
    let received: string | null = null;
    const app = Fastify({ logger: false });
    await app.register(adminMetaCaptureRoutes, {
      prefix: "/admin/v1",
      inventoryEnabledImpl: () => false,
      loadInventoryImpl: async () => {
        throw new Error("live discovery must not run while the flag is off");
      },
      createCredentialImpl: async (input) => {
        received = input.accessToken;
        return { ok: true, credential: publicCredential() };
      },
    });
    const denied = await app.inject({ method: "GET", url: "/admin/v1/meta-capture/health" });
    assert.equal(denied.statusCode, 401);

    const created = await app.inject({
      method: "POST",
      url: "/admin/v1/meta-capture/credentials",
      headers: { "x-sa360-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: {
        kind: "page_access_token",
        label: "Page A",
        accessToken: LEAK,
        pages: [{ pageId: "102720336121632" }],
      },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(received, LEAK);
    assert.equal(created.body.includes(LEAK), false);
    assert.match(created.body, /abc123def456/);
    const body = created.json() as { credential: { pages: Array<{ captureEnabled: boolean }> } };
    assert.equal(body.credential.pages[0]?.captureEnabled, false);

    const live = await app.inject({
      method: "GET",
      url: "/admin/v1/meta-capture/inventory?live=1&credentialId=cred_1",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(live.statusCode, 409);
    assert.equal(live.json().error, "inventory_disabled");
    await app.close();
  });
});

test("candidate registry import rejects client ownership and accepts 22 forms across five Pages", () => {
  const pages = ["11", "22", "33", "44", "55"].map((marker, pageIndex) => ({
    pageId: `${marker}00000000000000`.slice(0, 16),
    pageName: `Candidate page ${pageIndex + 1}`,
    forms: Array.from({ length: pageIndex === 4 ? 6 : 4 }, (_, formIndex) => ({
      formId: `${marker}${formIndex + 1}000000000000`.slice(0, 16),
      formName: `Form ${formIndex + 1}`,
    })),
  }));
  const formCount = pages.reduce((sum, page) => sum + page.forms.length, 0);
  assert.equal(pages.length, 5);
  assert.equal(formCount, 22);
  const parsed = parseMetaCandidateRegistry({
    sourceLabel: "sanitized_campaign_registry",
    pages,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.rows.length, 22);
  const owned = parseMetaCandidateRegistry({
    sourceLabel: "sanitized_campaign_registry",
    pages,
    clientAccountId: "client_should_not_import",
  });
  assert.equal(owned.ok, false);
  if (!owned.ok) assert.equal(owned.error, "candidate_is_not_ownership");
});
