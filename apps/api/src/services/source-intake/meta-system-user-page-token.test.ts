import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  exchangeSystemUserPageToken,
  listSystemUserPageAccounts,
  selectExactPageAccessToken,
  SYSTEM_USER_PAGE_ACCOUNT_FIELDS,
} from "./meta-system-user-page-token.js";

const SYSTEM_V1 = "EAAB-system-user-v1-token-not-real";
const SYSTEM_V2 = "EAAB-system-user-v2-token-not-real";
const PAGE_A = "222591640945329";
const PAGE_A_NEAR = "2225916409453299";
const PAGE_B = "102720336121633";
const TOKEN_A = "EAABPageAAccessTokenValueNotReal";
const TOKEN_A_NEAR = "EAABPageNearAccessTokenValueNotReal";
const TOKEN_B = "EAABPageBAccessTokenValueNotReal";
const TOKEN_A2 = "EAABPageARotatedAccessTokenNotReal";
const TOKEN_B2 = "EAABPageBRotatedAccessTokenNotReal";
const PAGING_TOKEN = "EAABPagingTokenMustNotBeFollowed";
const SECRET = "app-secret-value-not-real";

test("selects only the exact Page id and ignores a longer neighboring id", () => {
  const pages = [
    { id: PAGE_A_NEAR, name: "Near", tasks: ["MANAGE_LEADS"], accessToken: TOKEN_A_NEAR },
    { id: PAGE_A, name: "Target", tasks: ["MANAGE_LEADS"], accessToken: TOKEN_A },
    { id: PAGE_B, name: "Other", tasks: ["ANALYZE"], accessToken: TOKEN_B },
    { id: "102720336121634", name: "No token", tasks: ["MANAGE_LEADS"], accessToken: null },
  ];
  const selected = selectExactPageAccessToken(pages, PAGE_A);
  assert.equal(selected.ok, true);
  if (selected.ok) {
    assert.equal(selected.pageId, PAGE_A);
    assert.equal(selected.accessToken, TOKEN_A);
    assert.notEqual(selected.accessToken, TOKEN_A_NEAR);
    assert.notEqual(selected.accessToken, TOKEN_B);
  }
  const missingToken = selectExactPageAccessToken(pages, "102720336121634");
  assert.equal(missingToken.ok, false);
  if (!missingToken.ok) {
    assert.equal(missingToken.reason, "page_token_missing");
    assert.equal(missingToken.diagnostic.includes(TOKEN_A), false);
    assert.equal(missingToken.diagnostic.includes(TOKEN_B), false);
  }
  const absent = selectExactPageAccessToken(pages, "102720336121635");
  assert.equal(absent.ok, false);
  if (!absent.ok) assert.equal(absent.diagnostic.includes(TOKEN_A_NEAR), false);
});

test("exchanges one system user token into isolated Page tokens and follows cursors, not paging URLs", async () => {
  const urls: string[] = [];
  const bearers: string[] = [];
  const list = await listSystemUserPageAccounts({
    systemUserToken: SYSTEM_V1,
    appSecret: SECRET,
    graphApiVersion: "v25.0",
    fetchImpl: async (url, init) => {
      const href = String(url);
      urls.push(href);
      bearers.push(new Headers(init?.headers).get("authorization") ?? "");
      const parsed = new URL(href);
      assert.equal(parsed.searchParams.get("fields"), SYSTEM_USER_PAGE_ACCOUNT_FIELDS);
      assert.equal(href.includes(SYSTEM_V1), false);
      assert.equal(href.includes(TOKEN_A), false);
      assert.equal(href.includes(PAGING_TOKEN), false);
      assert.equal(
        parsed.searchParams.get("appsecret_proof"),
        createHmac("sha256", SECRET).update(SYSTEM_V1, "utf8").digest("hex")
      );
      if (!parsed.searchParams.get("after")) {
        return json({
          data: [
            { id: PAGE_A, name: "Target", tasks: ["MANAGE_LEADS"], access_token: TOKEN_A },
            { id: PAGE_A_NEAR, name: "Near", tasks: ["MANAGE_LEADS"], access_token: TOKEN_A_NEAR },
          ],
          paging: {
            cursors: { after: "CURSOR_1" },
            next: `https://graph.facebook.com/v25.0/me/accounts?access_token=${PAGING_TOKEN}`,
          },
        });
      }
      return json({
        data: [
          { id: PAGE_B, name: "Other", tasks: ["ANALYZE"], access_token: TOKEN_B },
          { id: "102720336121634", name: "Empty", tasks: ["MANAGE_LEADS"] },
        ],
      });
    },
  });

  assert.equal(urls.length, 2);
  assert.deepEqual(bearers, [`Bearer ${SYSTEM_V1}`, `Bearer ${SYSTEM_V1}`]);
  const target = selectExactPageAccessToken(list.pages, PAGE_A);
  const other = selectExactPageAccessToken(list.pages, PAGE_B);
  const empty = selectExactPageAccessToken(list.pages, "102720336121634");
  assert.equal(target.ok && target.accessToken, TOKEN_A);
  assert.equal(other.ok && other.accessToken, TOKEN_B);
  assert.equal(empty.ok, false);
  const publicJson = JSON.stringify(list.pages.map((page) => ({ id: page.id, name: page.name, tasks: page.tasks })));
  assert.equal(publicJson.includes(TOKEN_A), false);
  assert.equal(publicJson.includes(TOKEN_B), false);
  assert.equal(publicJson.includes(SYSTEM_V1), false);
  assert.equal(list.pages.find((page) => page.id === PAGE_A)?.tasks.includes("MANAGE_LEADS"), true);
});

test("OAuth error 190 is a permission failure and does not echo the system user token", async () => {
  const exchanged = await exchangeSystemUserPageToken({
    systemUserToken: SYSTEM_V1,
    pageId: PAGE_A,
    appSecret: SECRET,
    fetchImpl: async () =>
      json({
        error: {
          code: 190,
          type: "OAuthException",
          message: `Invalid OAuth 2.0 Access Token ${SYSTEM_V1}`,
        },
      }, 400),
  });
  assert.equal(exchanged.ok, false);
  if (!exchanged.ok) {
    assert.equal(exchanged.reason, "missing_permission");
    assert.equal(exchanged.retryable, false);
    assert.equal(exchanged.graphCode, "190");
    assert.match(exchanged.diagnostic, /190/);
    assert.equal(exchanged.diagnostic.includes(SYSTEM_V1), false);
    assert.equal(JSON.stringify(exchanged).includes(SYSTEM_V1), false);
  }
});

test("a listed Page without an access token fails closed", async () => {
  const urls: string[] = [];
  const exchanged = await exchangeSystemUserPageToken({
    systemUserToken: SYSTEM_V1,
    pageId: PAGE_A,
    appSecret: null,
    fetchImpl: async (url) => {
      urls.push(String(url));
      return json({
        data: [
          { id: PAGE_B, name: "Other", tasks: ["MANAGE_LEADS"], access_token: TOKEN_B },
          { id: PAGE_A, name: "Target", tasks: ["MANAGE_LEADS"] },
        ],
      });
    },
  });
  assert.equal(urls.length, 1);
  assert.equal(exchanged.ok, false);
  if (!exchanged.ok) {
    assert.equal(exchanged.reason, "page_token_missing");
    assert.equal(exchanged.retryable, false);
    assert.match(exchanged.diagnostic, new RegExp(PAGE_A));
    assert.equal(exchanged.diagnostic.includes(TOKEN_B), false);
    assert.equal(exchanged.diagnostic.includes(SYSTEM_V1), false);
  }
});

test("a Page that is not listed does not receive another Page token", async () => {
  const exchanged = await exchangeSystemUserPageToken({
    systemUserToken: SYSTEM_V1,
    pageId: PAGE_A,
    appSecret: null,
    fetchImpl: async () =>
      json({
        data: [{ id: PAGE_A_NEAR, name: "Near", tasks: ["MANAGE_LEADS"], access_token: TOKEN_A_NEAR }],
      }),
  });
  assert.equal(exchanged.ok, false);
  if (!exchanged.ok) {
    assert.equal(exchanged.reason, "page_token_missing");
    assert.equal(exchanged.diagnostic.includes(TOKEN_A_NEAR), false);
  }
});

test("rate limiting the accounts call is retryable and does not select a Page token", async () => {
  const exchanged = await exchangeSystemUserPageToken({
    systemUserToken: SYSTEM_V1,
    pageId: PAGE_A,
    appSecret: null,
    fetchImpl: async () => json({ error: { code: 4, message: `limit ${SYSTEM_V1}` } }, 400),
  });
  assert.equal(exchanged.ok, false);
  if (!exchanged.ok) {
    assert.equal(exchanged.reason, "page_token_exchange_unavailable");
    assert.equal(exchanged.retryable, true);
    assert.equal(exchanged.diagnostic.includes(SYSTEM_V1), false);
  }
});

test("token rotation presents the new system user token and returns that version's Page tokens", async () => {
  const bearers: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const bearer = new Headers(init?.headers).get("authorization") ?? "";
    bearers.push(bearer);
    assert.equal(String(url).includes(SYSTEM_V1), false);
    assert.equal(String(url).includes(SYSTEM_V2), false);
    const current = bearer.endsWith(SYSTEM_V2)
      ? [
          { id: PAGE_A, name: "Target", tasks: ["MANAGE_LEADS"], access_token: TOKEN_A2 },
          { id: PAGE_B, name: "Other", tasks: ["MANAGE_LEADS"], access_token: TOKEN_B2 },
        ]
      : [
          { id: PAGE_A, name: "Target", tasks: ["MANAGE_LEADS"], access_token: TOKEN_A },
          { id: PAGE_B, name: "Other", tasks: ["MANAGE_LEADS"], access_token: TOKEN_B },
        ];
    return json({ data: current });
  };
  const firstA = await exchangeSystemUserPageToken({
    systemUserToken: SYSTEM_V1,
    pageId: PAGE_A,
    appSecret: null,
    fetchImpl,
  });
  const firstB = await exchangeSystemUserPageToken({
    systemUserToken: SYSTEM_V1,
    pageId: PAGE_B,
    appSecret: null,
    fetchImpl,
  });
  const rotatedA = await exchangeSystemUserPageToken({
    systemUserToken: SYSTEM_V2,
    pageId: PAGE_A,
    appSecret: null,
    fetchImpl,
  });
  assert.equal(firstA.ok && firstA.accessToken, TOKEN_A);
  assert.equal(firstB.ok && firstB.accessToken, TOKEN_B);
  assert.equal(rotatedA.ok && rotatedA.accessToken, TOKEN_A2);
  if (firstA.ok && firstB.ok && rotatedA.ok) {
    assert.notEqual(firstA.accessToken, firstB.accessToken);
    assert.notEqual(firstA.accessToken, rotatedA.accessToken);
  }
  assert.deepEqual(bearers, [`Bearer ${SYSTEM_V1}`, `Bearer ${SYSTEM_V1}`, `Bearer ${SYSTEM_V2}`]);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
