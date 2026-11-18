import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { metaLeadgenSubscriptionConfirmation } from "../services/source-intake/meta-leadgen-subscription.service.js";
import { adminMetaLeadgenSubscriptionRoutes } from "./admin-meta-leadgen-subscription.js";

const ADMIN_KEY = "leadgen-subscription-admin";
const APP_ID = "1641287293781686";
const SECRET = "route-app-secret-not-real-value";
const SYSTEM = "EAABRouteSystemUserTokenValueNotReal";
const PAGE_ID = "222591640945329";
const PAGE_TOKEN = "EAABRoutePageToken222591640945329NotReal";
const CREDENTIAL_ID = "cmwl1r7hv001aiv0ujzbt0zjp";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function withAdmin<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
}

test("leadgen subscription routes require the admin key and do not echo tokens", async () => {
  await withAdmin(async () => {
    let calls = 0;
    let subscriptionReads = 0;
    const app = Fastify({ logger: false });
    await app.register(adminMetaLeadgenSubscriptionRoutes, {
      prefix: "/admin/v1",
      deps: {
        settings: {
          writesEnabled: true,
          intakeEnabled: false,
          graphFetchEnabled: false,
          routingEnabled: false,
          legacyDirectIntakeEnabled: false,
          appSecret: SECRET,
          graphApiVersion: "v25.0",
          expectedAppId: APP_ID,
        },
        decryptImpl: () => SYSTEM,
        loadCredentialImpl: async () => ({
          id: CREDENTIAL_ID,
          kind: "system_user",
          status: "active",
          appId: APP_ID,
          expiresAt: null,
          scopes: ["pages_show_list", "pages_manage_metadata"],
          tokenCiphertext: "ciphertext-not-a-token",
          tokenFingerprint: "fp1234567890",
          pageGrants: [{ pageId: PAGE_ID, pageName: "First Page", captureEnabled: false }],
        }),
        fetchImpl: async (url, init) => {
          calls += 1;
          const href = String(url);
          const method = (init?.method ?? "GET").toUpperCase();
          if (href.includes("/debug_token")) {
            return json({
              data: {
                is_valid: true,
                app_id: APP_ID,
                expires_at: 0,
                scopes: ["pages_show_list", "pages_manage_metadata"],
              },
            });
          }
          if (href.includes("/me/accounts")) {
            return json({
              data: [{ id: PAGE_ID, name: "First Page", tasks: ["MANAGE_LEADS"], access_token: PAGE_TOKEN }],
            });
          }
          if (method === "POST") {
            const subscribedFields = new URL(href).searchParams.get("subscribed_fields");
            assert.equal(subscribedFields, "leadgen");
            return json({ success: true });
          }
          subscriptionReads += 1;
          return json({
            data: [{ id: APP_ID, name: "SA360", subscribed_fields: subscriptionReads >= 3 ? ["leadgen"] : [] }],
          });
        },
      },
    });

    const denied = await app.inject({
      method: "GET",
      url: `/admin/v1/meta-capture/credentials/${CREDENTIAL_ID}/leadgen-subscriptions`,
    });
    assert.equal(denied.statusCode, 401);
    assert.equal(calls, 0);

    const missingConfirmation = await app.inject({
      method: "POST",
      url: `/admin/v1/meta-capture/credentials/${CREDENTIAL_ID}/pages/${PAGE_ID}/subscribe-leadgen`,
      headers: { "x-sa360-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: {},
    });
    assert.equal(missingConfirmation.statusCode, 400);
    assert.equal(missingConfirmation.json().error, "confirmation_required");
    assert.equal(calls, 0);

    const read = await app.inject({
      method: "GET",
      url: `/admin/v1/meta-capture/credentials/${CREDENTIAL_ID}/leadgen-subscriptions`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(read.statusCode, 200);
    const readBody = read.json() as {
      captureGrantMutated: boolean;
      pages: Array<{ pageId: string; captureEnabled: boolean; sa360LeadgenSubscribed: boolean }>;
    };
    assert.equal(readBody.captureGrantMutated, false);
    assert.equal(readBody.pages[0]?.pageId, PAGE_ID);
    assert.equal(readBody.pages[0]?.captureEnabled, false);
    assert.equal(readBody.pages[0]?.sa360LeadgenSubscribed, false);
    assert.equal(read.body.includes(SYSTEM), false);
    assert.equal(read.body.includes(PAGE_TOKEN), false);
    assert.equal(read.body.includes(SECRET), false);

    const callsAfterRead = calls;
    const subscribed = await app.inject({
      method: "POST",
      url: `/admin/v1/meta-capture/credentials/${CREDENTIAL_ID}/pages/${PAGE_ID}/subscribe-leadgen`,
      headers: { "x-sa360-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: { confirmed: true, confirmationText: metaLeadgenSubscriptionConfirmation(PAGE_ID) },
    });
    assert.equal(subscribed.statusCode, 200);
    const body = subscribed.json() as {
      verifiedByGet: boolean;
      postSent: boolean;
      captureEnabled: boolean;
      captureGrantMutated: boolean;
      action: string;
    };
    assert.equal(body.action, "subscribed");
    assert.equal(body.postSent, true);
    assert.equal(body.verifiedByGet, true);
    assert.equal(body.captureEnabled, false);
    assert.equal(body.captureGrantMutated, false);
    assert.equal(subscribed.body.includes(SYSTEM), false);
    assert.equal(subscribed.body.includes(PAGE_TOKEN), false);
    assert.equal(subscribed.body.includes(SECRET), false);
    assert.equal(calls > callsAfterRead, true);
    await app.close();
  });
});

test("subscription POST stays disabled when the writes flag is off", async () => {
  await withAdmin(async () => {
    let calls = 0;
    const app = Fastify({ logger: false });
    await app.register(adminMetaLeadgenSubscriptionRoutes, {
      prefix: "/admin/v1",
      deps: {
        settings: {
          writesEnabled: false,
          intakeEnabled: false,
          graphFetchEnabled: false,
          routingEnabled: false,
          legacyDirectIntakeEnabled: false,
          appSecret: SECRET,
          graphApiVersion: "v25.0",
          expectedAppId: APP_ID,
        },
        fetchImpl: async () => {
          calls += 1;
          return json({ success: true });
        },
        decryptImpl: () => SYSTEM,
        loadCredentialImpl: async () => {
          throw new Error("credential must not be loaded while writes are disabled");
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: `/admin/v1/meta-capture/credentials/${CREDENTIAL_ID}/pages/${PAGE_ID}/subscribe-leadgen`,
      headers: { "x-sa360-admin-key": ADMIN_KEY, "content-type": "application/json" },
      payload: { confirmed: true, confirmationText: metaLeadgenSubscriptionConfirmation(PAGE_ID) },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "writes_disabled");
    assert.equal(response.body.includes(SYSTEM), false);
    assert.equal(calls, 0);
    await app.close();
  });
});
