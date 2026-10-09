import assert from "node:assert/strict";
import test from "node:test";

import {
  getMetaReviewPreflight,
  getMetaReviewSubscription,
  listMetaReviewInsights,
  listMetaReviewPages,
  listMetaReviewPermissions,
  listMetaReviewPosts,
  MetaReviewError,
  subscribeMetaReviewLeadgen,
  type MetaReviewConfig,
} from "./meta-review.service.js";

const USER_TOKEN = "EAA-user-token-value-that-must-never-leak";
const PAGE_TOKEN = "EAA-page-token-value-that-must-never-leak";

function config(overrides: Partial<MetaReviewConfig> = {}): MetaReviewConfig {
  return {
    enabled: true,
    writesEnabled: false,
    graphApiVersion: "v25.0",
    userAccessToken: USER_TOKEN,
    pageAccessToken: PAGE_TOKEN,
    pageAccessTokenPageId: "10001",
    appId: "1641287293781686",
    appSecret: "app-secret-value",
    allowedPageIds: new Set(["10001"]),
    allowedAdAccountIds: new Set(["20001"]),
    callbackConfigured: true,
    intakeEnabled: false,
    graphFetchEnabled: false,
    routingEnabled: false,
    legacyDirectIntakeEnabled: false,
    ...overrides,
  };
}

function jsonFetch(
  body: unknown,
  status = 200,
  observe?: (url: string, init?: RequestInit) => void
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    observe?.(String(input), init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

test("preflight exposes only token presence, allowlists, callbacks, and inert intake flags", () => {
  const value = getMetaReviewPreflight(config());
  assert.equal(value.tokens.userOrSystemUser.masked, "configured (masked)");
  assert.equal(value.tokens.page.masked, "configured (masked)");
  assert.deepEqual(value.allowlists.pageIds, ["10001"]);
  assert.equal(value.productionSafety.safeForReview, true);
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /EAA-|app-secret-value/);
});

test("page discovery uses a bearer user token and returns allowlisted Pages only", async () => {
  let observedUrl = "";
  let observedAuth = "";
  const result = await listMetaReviewPages(
    config(),
    jsonFetch(
      {
        data: [
          { id: "10001", name: "Dedicated Review Page", tasks: ["MANAGE", "ADVERTISE"] },
          { id: "99999", name: "Production Customer Page", tasks: ["MANAGE"] },
        ],
      },
      200,
      (url, init) => {
        observedUrl = url;
        observedAuth = String((init?.headers as Record<string, string>)?.Authorization);
      }
    )
  );
  assert.deepEqual(result.items, [
    { id: "10001", name: "Dedicated Review Page", tasks: ["MANAGE", "ADVERTISE"] },
  ]);
  assert.equal(observedAuth, `Bearer ${USER_TOKEN}`);
  assert.equal(observedUrl.includes("access_token"), false);
  assert.equal(JSON.stringify(result).includes(USER_TOKEN), false);
  assert.equal(result.trace.endpoint.includes("appsecret_proof"), false);
});

test("permission diagnostic exposes only review-relevant permission statuses", async () => {
  const result = await listMetaReviewPermissions(
    config(),
    jsonFetch({
      data: [
        { permission: "pages_show_list", status: "granted" },
        { permission: "email", status: "granted" },
        { permission: "ads_read", status: "declined" },
      ],
    })
  );
  assert.deepEqual(result.items, [
    { permission: "pages_show_list", status: "granted" },
    { permission: "ads_read", status: "declined" },
  ]);
});

test("Page subscription and post reads reject IDs outside the allowlist before Graph", async () => {
  let calls = 0;
  const fetchImpl = jsonFetch({}, 200, () => {
    calls += 1;
  });
  await assert.rejects(
    () => getMetaReviewSubscription("99999", config(), fetchImpl),
    (error: unknown) => error instanceof MetaReviewError && error.code === "not_allowlisted"
  );
  await assert.rejects(
    () => listMetaReviewPosts("99999", config(), fetchImpl),
    (error: unknown) => error instanceof MetaReviewError && error.code === "not_allowlisted"
  );
  assert.equal(calls, 0);
});

test("post reads limit fields and truncate Page-owned message content", async () => {
  let observedUrl = "";
  const result = await listMetaReviewPosts(
    "10001",
    config(),
    jsonFetch(
      {
        data: [
          {
            id: "10001_30001",
            message: "x".repeat(700),
            created_time: "2026-10-01T00:00:00+0000",
            permalink_url: "https://www.facebook.com/10001/posts/30001",
            unexpected_private_field: "must not escape",
          },
        ],
      },
      200,
      (url) => {
        observedUrl = url;
      }
    )
  );
  assert.equal(result.items[0]?.message?.length, 500);
  assert.equal(JSON.stringify(result).includes("unexpected_private_field"), false);
  assert.match(observedUrl, /limit=5/);
});

test("insights require an allowlisted account and an explicit bounded date range", async () => {
  const result = await listMetaReviewInsights(
    "act_20001",
    "2026-10-01",
    "2026-10-07",
    config(),
    jsonFetch({
      data: [
        {
          campaign_id: "40001",
          campaign_name: "Review Campaign",
          impressions: "123",
          spend: "4.56",
          date_start: "2026-10-01",
          date_stop: "2026-10-07",
          account_currency: "USD",
        },
      ],
    })
  );
  assert.equal(result.adAccountId, "act_20001");
  assert.equal(result.items[0]?.campaignName, "Review Campaign");
  assert.equal(JSON.stringify(result).includes("account_currency"), false);
  await assert.rejects(
    () =>
      listMetaReviewInsights(
        "20001",
        "2026-10-08",
        "2026-10-01",
        config(),
        jsonFetch({})
      ),
    (error: unknown) => error instanceof MetaReviewError && error.code === "invalid_input"
  );
});

test("Graph errors are field-limited and redact token-shaped values", async () => {
  await assert.rejects(
    () =>
      listMetaReviewPages(
        config(),
        jsonFetch(
          {
            error: {
              message: `Invalid OAuth token ${USER_TOKEN} access_token=${PAGE_TOKEN}`,
              type: "OAuthException",
              code: 190,
              error_subcode: 463,
              fbtrace_id: "internal-trace",
            },
            raw_debug: "must not escape",
          },
          400
        )
      ),
    (error: unknown) => {
      assert.ok(error instanceof MetaReviewError);
      assert.equal(error.code, "graph_error");
      const serialized = JSON.stringify({ message: error.message, trace: error.trace });
      assert.equal(serialized.includes(USER_TOKEN), false);
      assert.equal(serialized.includes(PAGE_TOKEN), false);
      assert.equal(serialized.includes("internal-trace"), false);
      assert.equal(serialized.includes("raw_debug"), false);
      assert.equal(error.trace?.error?.code, "190");
      return true;
    }
  );
});

test("subscription write is disabled by default and duplicate-safe when enabled", async () => {
  let calls = 0;
  await assert.rejects(
    () => subscribeMetaReviewLeadgen("10001", "SUBSCRIBE LEADGEN", config(), jsonFetch({})),
    (error: unknown) => error instanceof MetaReviewError && error.code === "writes_disabled"
  );

  const duplicate = await subscribeMetaReviewLeadgen(
    "10001",
    "SUBSCRIBE LEADGEN",
    config({ writesEnabled: true }),
    jsonFetch(
      {
        data: [
          {
            id: "1641287293781686",
            name: "SA360",
            subscribed_fields: ["leadgen"],
          },
        ],
      },
      200,
      () => {
        calls += 1;
      }
    )
  );
  assert.equal(duplicate.alreadySubscribed, true);
  assert.equal(calls, 1, "readback prevents a duplicate POST");
});

test("subscription write requires the exact operator confirmation before any Graph call", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      subscribeMetaReviewLeadgen(
        "10001",
        "yes",
        config({ writesEnabled: true }),
        jsonFetch({}, 200, () => {
          calls += 1;
        })
      ),
    (error: unknown) =>
      error instanceof MetaReviewError && error.code === "confirmation_required"
  );
  assert.equal(calls, 0);
});

test("subscription write fails closed when any production intake path is active", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      subscribeMetaReviewLeadgen(
        "10001",
        "SUBSCRIBE LEADGEN",
        config({ writesEnabled: true, routingEnabled: true }),
        jsonFetch({}, 200, () => {
          calls += 1;
        })
      ),
    (error: unknown) =>
      error instanceof MetaReviewError && error.code === "production_unsafe"
  );
  assert.equal(calls, 0);
});
