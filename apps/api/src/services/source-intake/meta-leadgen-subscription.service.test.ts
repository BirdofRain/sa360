import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { SYSTEM_USER_PAGE_ACCOUNT_FIELDS } from "./meta-system-user-page-token.js";
import {
  isMetaLeadgenSubscriptionProductionSafe,
  metaLeadgenSubscriptionConfirmation,
  readMetaLeadgenSubscriptionSettings,
  readMetaLeadgenSubscriptions,
  subscribeMetaLeadgenPage,
  type MetaLeadgenSubscriptionDeps,
  type MetaLeadgenSubscriptionSettings,
  type StoredMetaSubscriptionCredential,
} from "./meta-leadgen-subscription.service.js";

const APP_ID = "1641287293781686";
const SECRET = "app-secret-subscription-not-real";
const SYSTEM = "EAABSystemUserSubscriptionTokenNotReal";
const CREDENTIAL_ID = "cmwl1r7hv001aiv0ujzbt0zjp";
const OTHER_APP = "555555555555555";
const NEAR_ID = "2225916409453299";
const NEAR_TOKEN = "EAABNearPageToken2225916409453299NotReal";
const SHARED_TOKEN = "EAABSharedPageTokenValueNotRealXXXX";
const PAGE_IDS = [
  "222591640945329",
  "222591640945330",
  "222591640945331",
  "222591640945332",
  "222591640945333",
  "222591640945334",
  "222591640945335",
  "222591640945336",
] as const;

type SeenCall = {
  method: string;
  path: string;
  bearer: string;
  subscribedFields: string | null;
  proof: string | null;
  fields: string | null;
};

type LogLine = { level: string; message: string; meta: Record<string, unknown> };

function pageToken(pageId: string): string {
  return `EAABPageToken${pageId}NotRealValue`;
}

function proofFor(token: string): string {
  return createHmac("sha256", SECRET).update(token, "utf8").digest("hex");
}

function settings(overrides: Partial<MetaLeadgenSubscriptionSettings> = {}): MetaLeadgenSubscriptionSettings {
  return {
    writesEnabled: false,
    intakeEnabled: false,
    graphFetchEnabled: false,
    routingEnabled: false,
    legacyDirectIntakeEnabled: false,
    appSecret: SECRET,
    graphApiVersion: "v25.0",
    expectedAppId: APP_ID,
    ...overrides,
  };
}

function credential(overrides: Partial<StoredMetaSubscriptionCredential> = {}): StoredMetaSubscriptionCredential {
  return {
    id: CREDENTIAL_ID,
    kind: "system_user",
    status: "active",
    appId: APP_ID,
    expiresAt: null,
    scopes: [
      "pages_show_list",
      "pages_manage_metadata",
      "pages_read_engagement",
      "leads_retrieval",
      "pages_manage_ads",
    ],
    tokenCiphertext: "ciphertext-not-a-token",
    tokenFingerprint: "fp1234567890",
    pageGrants: PAGE_IDS.map((pageId, index) => ({
      pageId,
      pageName: `Page ${index + 1}`,
      captureEnabled: false,
    })),
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function see(url: string, init?: RequestInit): SeenCall {
  const parsed = new URL(url);
  return {
    method: (init?.method ?? "GET").toUpperCase(),
    path: parsed.pathname.replace(/^\/v[\d.]+\//, ""),
    bearer: new Headers(init?.headers).get("authorization") ?? "",
    subscribedFields: parsed.searchParams.get("subscribed_fields"),
    proof: parsed.searchParams.get("appsecret_proof"),
    fields: parsed.searchParams.get("fields"),
  };
}

function forbidSecrets(value: unknown, extra: string[] = []): void {
  const jsonText = JSON.stringify(value);
  const secrets = [SYSTEM, SECRET, NEAR_TOKEN, SHARED_TOKEN, "ciphertext-not-a-token", `${APP_ID}|${SECRET}`, ...PAGE_IDS.map(pageToken), ...extra];
  for (const secret of secrets) {
    assert.equal(jsonText.includes(secret), false, `secret leaked: ${secret.slice(0, 12)}…`);
  }
  assert.equal(jsonText.includes("accessToken"), false);
  assert.equal(jsonText.includes("tokenCiphertext"), false);
  assert.equal(jsonText.includes("appsecret_proof"), false);
  assert.equal(jsonText.includes("input_token"), false);
}

function deps(input: {
  fetchImpl?: typeof fetch;
  record?: StoredMetaSubscriptionCredential;
  settings?: Partial<MetaLeadgenSubscriptionSettings>;
  logs?: LogLine[];
  decryptImpl?: (ciphertext: string) => string;
  loadCredentialImpl?: MetaLeadgenSubscriptionDeps["loadCredentialImpl"];
}): { deps: MetaLeadgenSubscriptionDeps; logs: LogLine[]; decrypts: { count: number } } {
  const logs = input.logs ?? [];
  const decrypts = { count: 0 };
  const record = input.record ?? credential();
  return {
    logs,
    decrypts,
    deps: {
      settings: settings(input.settings),
      fetchImpl: input.fetchImpl,
      loadCredentialImpl:
        input.loadCredentialImpl ??
        (async (credentialId) => (record.id === credentialId ? record : null)),
      decryptImpl:
        input.decryptImpl ??
        ((ciphertext) => {
          decrypts.count += 1;
          assert.equal(ciphertext, record.tokenCiphertext);
          return SYSTEM;
        }),
      logImpl: (level, message, meta) => logs.push({ level, message, meta }),
      now: () => new Date("2026-11-18T15:00:00.000Z"),
    },
  };
}

function debugToken(data: Record<string, unknown> = {}): Response {
  return json({
    data: {
      is_valid: true,
      app_id: APP_ID,
      expires_at: 0,
      type: "SYSTEM_USER",
      scopes: [
        "pages_show_list",
        "pages_manage_metadata",
        "pages_read_engagement",
        "leads_retrieval",
        "pages_manage_ads",
      ],
      ...data,
    },
  });
}

function accountRow(pageId: string, token: string | null, name = pageId): Record<string, unknown> {
  return {
    id: pageId,
    name,
    tasks: ["MANAGE_LEADS"],
    ...(token ? { access_token: token } : {}),
  };
}

function subscribed(pageId: string): Response {
  if (pageId === PAGE_IDS[0]) {
    return json({
      data: [
        { id: OTHER_APP, name: "Other App", subscribed_fields: ["feed"] },
        { id: APP_ID, name: "SA360", subscribed_fields: ["messages"] },
      ],
    });
  }
  if (pageId === PAGE_IDS[1]) {
    return json({
      data: [
        { id: APP_ID, name: "SA360", subscribed_fields: ["feed", "leadgen"] },
        { id: OTHER_APP, name: "Other App", subscribed_fields: ["messages"] },
      ],
    });
  }
  return json({
    data: [{ id: OTHER_APP, name: "Other App", subscribed_fields: ["messages"] }],
  });
}

test("reads eight granted Pages with the exact Page token and reports SA360 leadgen", async () => {
  const record = credential({
    pageGrants: [...PAGE_IDS].reverse().map((pageId) => ({
      pageId,
      pageName: `Page ${pageId}`,
      captureEnabled: false,
    })),
  });
  const calls: SeenCall[] = [];
  const harness = deps({
    record,
    fetchImpl: async (url, init) => {
      const call = see(String(url), init);
      calls.push(call);
      assert.notEqual(call.method, "POST");
      assert.notEqual(call.method, "DELETE");
      if (call.path === "debug_token") {
        assert.equal(call.bearer, `Bearer ${APP_ID}|${SECRET}`);
        return debugToken();
      }
      if (call.path === "me/accounts") {
        assert.equal(call.bearer, `Bearer ${SYSTEM}`);
        assert.equal(call.fields, SYSTEM_USER_PAGE_ACCOUNT_FIELDS);
        return json({
          data: [
            accountRow(NEAR_ID, NEAR_TOKEN, "Near miss"),
            ...PAGE_IDS.map((pageId) => accountRow(pageId, pageToken(pageId), `Name ${pageId}`)),
          ],
        });
      }
      assert.equal(call.path.endsWith("/subscribed_apps"), true);
      const pageId = call.path.split("/")[0] ?? "";
      assert.equal(call.bearer, `Bearer ${pageToken(pageId)}`);
      assert.equal(call.proof, proofFor(pageToken(pageId)));
      assert.notEqual(call.proof, proofFor(SYSTEM));
      assert.notEqual(call.bearer, `Bearer ${NEAR_TOKEN}`);
      return subscribed(pageId);
    },
  });

  const result = await readMetaLeadgenSubscriptions(CREDENTIAL_ID, harness.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pages.length, 8);
  assert.deepEqual(
    result.pages.map((page) => page.pageId),
    [...PAGE_IDS]
  );
  assert.equal(result.partial, false);
  assert.equal(result.captureGrantMutated, false);
  assert.equal(result.writesEnabled, false);
  assert.equal(result.productionSafe, true);
  assert.equal(result.appIdVerified, true);
  assert.equal(result.pages[0]?.sa360LeadgenSubscribed, false);
  assert.deepEqual(result.pages[0]?.sa360SubscribedFields, ["messages"]);
  assert.deepEqual(result.pages[0]?.otherApps.map((app) => app.appId), [OTHER_APP]);
  assert.equal(result.pages[1]?.sa360LeadgenSubscribed, true);
  assert.equal(result.pages[2]?.sa360LeadgenSubscribed, false);
  assert.equal(result.pages.every((page) => page.captureEnabled === false), true);
  assert.equal(result.pages.every((page) => page.subscriptionKnown), true);
  assert.equal(calls.filter((call) => call.path === "me/accounts").length, 1);
  assert.equal(calls.filter((call) => call.path === "debug_token").length, 1);
  assert.equal(calls.some((call) => call.path.startsWith(`${NEAR_ID}/`)), false);
  assert.equal(calls.some((call) => call.path.includes("leadgen_forms")), false);
  assert.equal(record.pageGrants.every((grant) => grant.captureEnabled === false), true);
  const loggedPages = harness.logs.map((line) => line.meta.pageId);
  for (const pageId of PAGE_IDS) assert.equal(loggedPages.includes(pageId), true);
  assert.equal(harness.logs.every((line) => line.meta.action === "read"), true);
  forbidSecrets(result);
  forbidSecrets(harness.logs);
});

test("partial Page failures stay isolated and a rate limit stops the remaining Pages", async () => {
  const calls: SeenCall[] = [];
  const harness = deps({
    fetchImpl: async (url, init) => {
      const call = see(String(url), init);
      calls.push(call);
      if (call.path === "debug_token") return debugToken();
      if (call.path === "me/accounts") {
        assert.equal(call.bearer, `Bearer ${SYSTEM}`);
        return json({ data: PAGE_IDS.map((pageId) => accountRow(pageId, pageToken(pageId))) });
      }
      const pageId = call.path.split("/")[0] ?? "";
      assert.equal(call.bearer, `Bearer ${pageToken(pageId)}`);
      assert.notEqual(call.bearer, `Bearer ${SYSTEM}`);
      if (pageId === PAGE_IDS[2]) {
        return json({ error: { code: 200, message: `permission denied ${pageToken(pageId)}` } }, 400);
      }
      if (pageId === PAGE_IDS[4]) {
        return json({ error: { code: 4, message: `rate limit ${SYSTEM}` } }, 400);
      }
      return subscribed(pageId);
    },
  });
  const result = await readMetaLeadgenSubscriptions(CREDENTIAL_ID, harness.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.partial, true);
  assert.equal(result.pages[0]?.subscriptionKnown, true);
  assert.equal(result.pages[1]?.sa360LeadgenSubscribed, true);
  assert.equal(result.pages[2]?.subscriptionKnown, false);
  assert.equal(result.pages[2]?.sa360LeadgenSubscribed, null);
  assert.equal(result.pages[2]?.error, "missing_permission");
  assert.equal(result.pages[3]?.subscriptionKnown, true);
  assert.equal(result.pages[3]?.error, null);
  assert.equal(result.pages[4]?.error, "rate_limited");
  assert.equal(result.pages[4]?.sa360LeadgenSubscribed, null);
  for (const page of result.pages.slice(5)) {
    assert.equal(page.error, "not_checked");
    assert.equal(page.subscriptionKnown, false);
    assert.equal(page.sa360LeadgenSubscribed, null);
  }
  const checked = calls.filter((call) => call.path.endsWith("/subscribed_apps")).map((call) => call.path.split("/")[0]);
  assert.deepEqual(checked, PAGE_IDS.slice(0, 5));
  assert.equal(result.captureGrantMutated, false);
  forbidSecrets(result);
  forbidSecrets(harness.logs);
});

test("a Page token that is missing or shared is not replaced with another token", async () => {
  const calls: SeenCall[] = [];
  const harness = deps({
    fetchImpl: async (url, init) => {
      const call = see(String(url), init);
      calls.push(call);
      if (call.path === "debug_token") return debugToken();
      if (call.path === "me/accounts") {
        return json({
          data: [
            accountRow(PAGE_IDS[0]!, null),
            accountRow(PAGE_IDS[1]!, SHARED_TOKEN),
            accountRow(PAGE_IDS[2]!, SHARED_TOKEN),
            ...PAGE_IDS.slice(3).map((pageId) => accountRow(pageId, pageToken(pageId))),
          ],
        });
      }
      const pageId = call.path.split("/")[0] ?? "";
      assert.equal(pageId === PAGE_IDS[0] || pageId === PAGE_IDS[1] || pageId === PAGE_IDS[2], false);
      assert.equal(call.bearer, `Bearer ${pageToken(pageId)}`);
      assert.notEqual(call.bearer, `Bearer ${SYSTEM}`);
      assert.notEqual(call.bearer, `Bearer ${SHARED_TOKEN}`);
      return subscribed(pageId);
    },
  });
  const result = await readMetaLeadgenSubscriptions(CREDENTIAL_ID, harness.deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pages[0]?.error, "page_token_missing");
  assert.equal(result.pages[1]?.error, "page_token_missing");
  assert.equal(result.pages[2]?.error, "page_token_missing");
  assert.equal(result.pages[3]?.subscriptionKnown, true);
  assert.equal(result.pages[3]?.sa360LeadgenSubscribed, false);
  const pageCalls = calls.filter((call) => call.path.endsWith("/subscribed_apps"));
  assert.deepEqual(
    pageCalls.map((call) => call.path.split("/")[0]),
    PAGE_IDS.slice(3)
  );
  forbidSecrets(result);
});

test("duplicate leadgen subscription does not POST", async () => {
  const calls: SeenCall[] = [];
  const harness = deps({
    settings: { writesEnabled: true },
    fetchImpl: async (url, init) => {
      const call = see(String(url), init);
      calls.push(call);
      assert.notEqual(call.method, "POST");
      if (call.path === "debug_token") return debugToken();
      if (call.path === "me/accounts") {
        return json({ data: PAGE_IDS.map((pageId) => accountRow(pageId, pageToken(pageId))) });
      }
      assert.equal(call.path, `${PAGE_IDS[1]}/subscribed_apps`);
      assert.equal(call.bearer, `Bearer ${pageToken(PAGE_IDS[1]!)}`);
      return subscribed(PAGE_IDS[1]!);
    },
  });
  const result = await subscribeMetaLeadgenPage(
    {
      credentialId: CREDENTIAL_ID,
      pageId: PAGE_IDS[1]!,
      confirmationText: metaLeadgenSubscriptionConfirmation(PAGE_IDS[1]!),
    },
    harness.deps
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.action, "already_subscribed");
  assert.equal(result.postSent, false);
  assert.equal(result.verifiedByGet, true);
  assert.equal(result.subscribedFieldsSent, null);
  assert.equal(result.captureEnabled, false);
  assert.equal(result.captureGrantMutated, false);
  assert.deepEqual(result.preservedFields, ["feed"]);
  assert.equal(calls.filter((call) => call.path.endsWith("/subscribed_apps")).length, 1);
  assert.equal(harness.logs.some((line) => line.meta.result === "already_subscribed" && line.meta.pageId === PAGE_IDS[1]), true);
  forbidSecrets(result);
  forbidSecrets(harness.logs);
});

test("subscribe posts the existing SA360 fields plus leadgen and verifies with a fresh GET", async () => {
  const calls: SeenCall[] = [];
  let subscribedGets = 0;
  const harness = deps({
    settings: { writesEnabled: true },
    fetchImpl: async (url, init) => {
      const call = see(String(url), init);
      calls.push(call);
      if (call.path === "debug_token") return debugToken();
      if (call.path === "me/accounts") {
        assert.equal(call.bearer, `Bearer ${SYSTEM}`);
        return json({
          data: [
            accountRow(NEAR_ID, NEAR_TOKEN),
            ...PAGE_IDS.map((pageId) => accountRow(pageId, pageToken(pageId))),
          ],
        });
      }
      assert.equal(call.path, `${PAGE_IDS[0]}/subscribed_apps`);
      assert.equal(call.bearer, `Bearer ${pageToken(PAGE_IDS[0]!)}`);
      assert.equal(call.proof, proofFor(pageToken(PAGE_IDS[0]!)));
      assert.notEqual(call.bearer, `Bearer ${pageToken(PAGE_IDS[1]!)}`);
      if (call.method === "GET") {
        subscribedGets += 1;
        if (subscribedGets === 1) {
          return json({
            data: [
              { id: OTHER_APP, name: "Other App", subscribed_fields: ["feed"] },
              { id: APP_ID, name: "SA360", subscribed_fields: ["feed", "messages"] },
            ],
          });
        }
        return json({
          data: [
            { id: APP_ID, name: "SA360", subscribed_fields: ["messages", "feed", "leadgen"] },
            { id: OTHER_APP, name: "Other App", subscribed_fields: ["feed"] },
          ],
        });
      }
      assert.equal(call.method, "POST");
      assert.equal(call.subscribedFields, "feed,messages,leadgen");
      assert.equal(call.subscribedFields?.includes(OTHER_APP), false);
      return json({ success: true });
    },
  });
  const result = await subscribeMetaLeadgenPage(
    {
      credentialId: CREDENTIAL_ID,
      pageId: PAGE_IDS[0]!,
      confirmationText: metaLeadgenSubscriptionConfirmation(PAGE_IDS[0]!),
    },
    harness.deps
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.action, "subscribed");
  assert.equal(result.postSent, true);
  assert.equal(result.verifiedByGet, true);
  assert.deepEqual(result.subscribedFieldsSent, ["feed", "messages", "leadgen"]);
  assert.deepEqual(result.preservedFields, ["feed", "messages"]);
  assert.equal(result.otherAppsUnchanged, true);
  assert.equal(result.captureEnabled, false);
  assert.equal(result.captureGrantMutated, false);
  assert.deepEqual(
    calls.filter((call) => call.path.endsWith("/subscribed_apps")).map((call) => call.method),
    ["GET", "POST", "GET"]
  );
  assert.equal(calls.some((call) => call.path.startsWith(`${NEAR_ID}/`)), false);
  assert.equal(calls.some((call) => call.path.startsWith(`${PAGE_IDS[1]}/`)), false);
  assert.equal(harness.logs.some((line) => line.meta.result === "verified" && line.meta.postSent === true), true);
  forbidSecrets(result);
  forbidSecrets(harness.logs);
});

test("a POST response is not success when the fresh GET does not confirm leadgen or other apps", async () => {
  async function run(after: unknown): Promise<Awaited<ReturnType<typeof subscribeMetaLeadgenPage>>> {
    let gets = 0;
    const harness = deps({
      settings: { writesEnabled: true },
      fetchImpl: async (url, init) => {
        const call = see(String(url), init);
        if (call.path === "debug_token") return debugToken();
        if (call.path === "me/accounts") {
          return json({ data: [accountRow(PAGE_IDS[0]!, pageToken(PAGE_IDS[0]!))] });
        }
        if (call.method === "POST") return json({ success: true });
        gets += 1;
        if (gets === 1) {
          return json({
            data: [
              { id: OTHER_APP, name: "Other App", subscribed_fields: ["feed"] },
              { id: APP_ID, name: "SA360", subscribed_fields: ["messages"] },
            ],
          });
        }
        return json(after);
      },
    });
    return subscribeMetaLeadgenPage(
      {
        credentialId: CREDENTIAL_ID,
        pageId: PAGE_IDS[0]!,
        confirmationText: metaLeadgenSubscriptionConfirmation(PAGE_IDS[0]!),
      },
      harness.deps
    );
  }

  const dropped = await run({
    data: [
      { id: OTHER_APP, name: "Other App", subscribed_fields: ["feed"] },
      { id: APP_ID, name: "SA360", subscribed_fields: ["leadgen"] },
    ],
  });
  assert.equal(dropped.ok, false);
  if (dropped.ok) return;
  assert.equal(dropped.error, "verification_failed");
  assert.equal(dropped.postSent, true);
  assert.equal(dropped.verifiedByGet, false);
  assert.equal(dropped.captureGrantMutated, false);
  assert.deepEqual(dropped.sa360SubscribedFields, ["leadgen"]);

  const otherAppChanged = await run({
    data: [
      { id: OTHER_APP, name: "Other App", subscribed_fields: ["mention"] },
      { id: APP_ID, name: "SA360", subscribed_fields: ["messages", "leadgen"] },
    ],
  });
  assert.equal(otherAppChanged.ok, false);
  if (otherAppChanged.ok) return;
  assert.equal(otherAppChanged.error, "verification_failed");
  assert.equal(otherAppChanged.otherAppsUnchanged, false);
  assert.equal(otherAppChanged.postSent, true);
  forbidSecrets(dropped);
  forbidSecrets(otherAppChanged);
});

test("subscription writes fail closed before Graph when confirmation, flags, or the credential are not exact", async () => {
  const cases: Array<{
    name: string;
    pageId?: string;
    confirmation?: string;
    settings?: Partial<MetaLeadgenSubscriptionSettings>;
    record?: StoredMetaSubscriptionCredential;
    loadCredentialImpl?: MetaLeadgenSubscriptionDeps["loadCredentialImpl"];
    error: string;
    decrypts?: number;
  }> = [
    { name: "confirmation", confirmation: "SUBSCRIBE LEADGEN", error: "confirmation_required" },
    {
      name: "wrong page confirmation",
      confirmation: metaLeadgenSubscriptionConfirmation(PAGE_IDS[1]!),
      error: "confirmation_required",
    },
    { name: "writes off", settings: { writesEnabled: false }, error: "writes_disabled" },
    { name: "intake on", settings: { writesEnabled: true, intakeEnabled: true }, error: "production_unsafe" },
    {
      name: "legacy intake on",
      settings: { writesEnabled: true, legacyDirectIntakeEnabled: true },
      error: "production_unsafe",
    },
    {
      name: "routing on",
      settings: { writesEnabled: true, routingEnabled: true },
      error: "production_unsafe",
    },
    {
      name: "graph fetch on",
      settings: { writesEnabled: true, graphFetchEnabled: true },
      error: "production_unsafe",
    },
    { name: "disabled credential", record: credential({ status: "disabled" }), error: "credential_not_active" },
    {
      name: "expired credential",
      record: credential({ expiresAt: new Date("2020-01-01T00:00:00.000Z") }),
      error: "token_expired",
    },
    {
      name: "page token credential",
      record: credential({ kind: "page_access_token" }),
      error: "credential_kind_unsupported",
    },
    {
      name: "wrong expected app",
      settings: { writesEnabled: true, expectedAppId: "999999999999999" },
      error: "wrong_app_id",
    },
    {
      name: "stored permission missing",
      record: credential({ scopes: ["leads_retrieval", "pages_show_list"] }),
      error: "missing_permission",
    },
    {
      name: "other credential",
      loadCredentialImpl: async () => credential({ id: "another-credential" }),
      error: "not_found",
    },
    {
      name: "page not granted",
      pageId: "333333333333333",
      error: "page_not_granted",
      decrypts: 1,
    },
  ];
  for (const item of cases) {
    let calls = 0;
    const pageId = item.pageId ?? PAGE_IDS[0]!;
    const harness = deps({
      settings: { writesEnabled: true, ...item.settings },
      record: item.record,
      loadCredentialImpl: item.loadCredentialImpl,
      fetchImpl: async () => {
        calls += 1;
        return json({ error: { message: "graph should not be called" } }, 500);
      },
    });
    const result = await subscribeMetaLeadgenPage(
      {
        credentialId: CREDENTIAL_ID,
        pageId,
        confirmationText: item.confirmation ?? metaLeadgenSubscriptionConfirmation(pageId),
      },
      harness.deps
    );
    assert.equal(result.ok, false, item.name);
    if (result.ok) continue;
    assert.equal(result.error, item.error, item.name);
    assert.equal(result.postSent, false, item.name);
    assert.equal(result.captureGrantMutated, false, item.name);
    assert.equal(calls, 0, item.name);
    assert.equal(harness.decrypts.count, item.decrypts ?? 0, item.name);
  }
});

test("live app id, permission, and /me/accounts failures do not call another Page", async () => {
  const wrongApp = deps({
    fetchImpl: async (url, init) => {
      const call = see(String(url), init);
      assert.equal(call.path, "debug_token");
      return debugToken({ app_id: "999999999999999" });
    },
  });
  const wrong = await readMetaLeadgenSubscriptions(CREDENTIAL_ID, wrongApp.deps);
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.error, "wrong_app_id");

  const missingScope = deps({
    fetchImpl: async (url, init) => {
      const call = see(String(url), init);
      assert.equal(call.path, "debug_token");
      return debugToken({ scopes: ["pages_show_list"] });
    },
  });
  const scope = await readMetaLeadgenSubscriptions(CREDENTIAL_ID, missingScope.deps);
  assert.equal(scope.ok, false);
  if (!scope.ok) assert.equal(scope.error, "missing_permission");

  const accountsRefusedCalls: string[] = [];
  const refused = deps({
    fetchImpl: async (url, init) => {
      const call = see(String(url), init);
      accountsRefusedCalls.push(call.path);
      if (call.path === "debug_token") return debugToken();
      if (call.path === "me/accounts") {
        assert.equal(call.bearer, `Bearer ${SYSTEM}`);
        return json({ error: { code: 190, message: `bad token ${SYSTEM}` } }, 400);
      }
      throw new Error(`unexpected ${call.path}`);
    },
  });
  const accounts = await readMetaLeadgenSubscriptions(CREDENTIAL_ID, refused.deps);
  assert.equal(accounts.ok, false);
  if (!accounts.ok) assert.equal(accounts.error, "missing_permission");
  assert.equal(accountsRefusedCalls.includes(`${PAGE_IDS[0]}/subscribed_apps`), false);
  forbidSecrets(accounts);

  let posts = 0;
  const preRead = deps({
    settings: { writesEnabled: true },
    fetchImpl: async (url, init) => {
      const call = see(String(url), init);
      if (call.method === "POST") posts += 1;
      if (call.path === "debug_token") return debugToken();
      if (call.path === "me/accounts") return json({ data: [accountRow(PAGE_IDS[0]!, pageToken(PAGE_IDS[0]!))] });
      assert.equal(call.bearer, `Bearer ${pageToken(PAGE_IDS[0]!)}`);
      return json({ error: { code: 190, message: `page refused ${pageToken(PAGE_IDS[0]!)}` } }, 400);
    },
  });
  const subscribe = await subscribeMetaLeadgenPage(
    {
      credentialId: CREDENTIAL_ID,
      pageId: PAGE_IDS[0]!,
      confirmationText: metaLeadgenSubscriptionConfirmation(PAGE_IDS[0]!),
    },
    preRead.deps
  );
  assert.equal(subscribe.ok, false);
  if (!subscribe.ok) assert.equal(subscribe.error, "missing_permission");
  assert.equal(posts, 0);
  forbidSecrets(subscribe);
});

test("subscription settings stay write-disabled unless the new flag is explicitly true", () => {
  const names = [
    "SA360_META_LEADGEN_SUBSCRIPTION_WRITES_ENABLED",
    "SA360_META_LEAD_ADS_INTAKE_ENABLED",
    "SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED",
    "SA360_META_LEAD_ADS_ROUTING_ENABLED",
    "FACEBOOK_DIRECT_INTAKE_ENABLED",
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  try {
    const value = readMetaLeadgenSubscriptionSettings();
    assert.equal(value.writesEnabled, false);
    assert.equal(isMetaLeadgenSubscriptionProductionSafe(value), true);
  } finally {
    for (const [name, previousValue] of previous) {
      if (previousValue === undefined) delete process.env[name];
      else process.env[name] = previousValue;
    }
  }
});
