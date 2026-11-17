import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  discoverMetaAuthorizedAssets,
  discoveryContainsSecret,
} from "./meta-capture-discovery.service.js";
import { SYSTEM_USER_PAGE_ACCOUNT_FIELDS } from "./meta-system-user-page-token.js";

const TOKEN = "EAAB-discovery-token-value-not-real";
const SECRET = "app-secret-value-not-real";
const PAGE = "102720336121632";

test("discovery paginates, stops on rate limit, and keeps permission failures off the token", async () => {
  const urls: string[] = [];
  const discovery = await discoverMetaAuthorizedAssets({
    credentialId: "cred_1",
    accessToken: TOKEN,
    appSecret: SECRET,
    appId: "1641287293781686",
    pageIds: [PAGE],
    fetchImpl: async (url) => {
      const href = String(url);
      urls.push(href);
      const path = href.split("?")[0] ?? href;
      if (path.endsWith("/debug_token")) {
        return json({
          data: {
            is_valid: true,
            expires_at: 0,
            scopes: ["leads_retrieval", "pages_manage_ads", "pages_read_engagement", "pages_show_list"],
            type: "SYSTEM_USER",
            app_id: "1641287293781686",
          },
        });
      }
      if (path.endsWith("/me/accounts")) {
        return json({
          data: [{ id: PAGE, name: "Pilot Page", tasks: ["ADVERTISE"] }],
        });
      }
      if (path.endsWith(`/${PAGE}/leadgen_forms`) && !href.includes("after=")) {
        return json({
          data: [{ id: "1149211490298917", name: "Form A", status: "ACTIVE" }],
          paging: { cursors: { after: "CURSOR_1" }, next: "https://graph.facebook.com/next?access_token=should-not-be-followed" },
        });
      }
      if (path.endsWith(`/${PAGE}/leadgen_forms`)) {
        return json({ error: { code: 4, message: `limit ${TOKEN}` } });
      }
      return json({ error: { code: 200, message: "permission" } });
    },
  });

  assert.equal(discovery.token.isValid, true);
  assert.equal(discovery.token.appIdMatches, true);
  assert.equal(discovery.forms.items.length, 1);
  assert.equal(discovery.forms.items[0]?.status, "ACTIVE");
  assert.equal(discovery.forms.rateLimited, true);
  assert.equal(discovery.adAccounts.items.length, 0);
  assert.equal(urls.some((url) => url.includes(TOKEN)), true);
  assert.equal(discoveryContainsSecret(discovery, TOKEN), false);
  assert.equal(discoveryContainsSecret(discovery, SECRET), false);
  assert.equal(urls.some((url) => url.includes("/1149211490298917")), false);
});

test("system user discovery uses each Page token only for that Page", async () => {
  const system = "EAABSystemUserDiscoveryTokenNotReal";
  const pageA = "222591640945329";
  const pageNear = "2225916409453299";
  const pageB = "102720336121633";
  const pageMissing = "102720336121634";
  const tokenA = "EAABPageADiscoveryTokenValueNotReal";
  const tokenNear = "EAABPageNearDiscoveryTokenValueNotReal";
  const tokenB = "EAABPageBDiscoveryTokenValueNotReal";
  const calls: Array<{ path: string; bearer: string; fields: string | null; proof: string | null }> = [];

  const discovery = await discoverMetaAuthorizedAssets({
    credentialId: "cred_system",
    accessToken: system,
    appSecret: SECRET,
    appId: "1641287293781686",
    credentialKind: "system_user",
    pageIds: [pageA, pageMissing],
    fetchImpl: async (url, init) => {
      const href = String(url);
      const parsed = new URL(href);
      const bearer = new Headers(init?.headers).get("authorization") ?? "";
      const path = parsed.pathname.replace(/^\/v25\.0\//, "");
      calls.push({
        path,
        bearer,
        fields: parsed.searchParams.get("fields"),
        proof: parsed.searchParams.get("appsecret_proof"),
      });
      assert.equal(href.includes(tokenA), false);
      assert.equal(href.includes(tokenB), false);
      assert.equal(href.includes(tokenNear), false);
      if (path === "debug_token") {
        return json({
          data: {
            is_valid: true,
            expires_at: 0,
            scopes: ["leads_retrieval", "pages_show_list", "pages_manage_metadata"],
            type: "SYSTEM_USER",
            app_id: "1641287293781686",
          },
        });
      }
      if (path === "me/accounts") {
        assert.equal(bearer, `Bearer ${system}`);
        assert.equal(parsed.searchParams.get("fields"), SYSTEM_USER_PAGE_ACCOUNT_FIELDS);
        return json({
          data: [
            { id: pageNear, name: "Near", tasks: ["MANAGE_LEADS"], access_token: tokenNear },
            { id: pageA, name: "Target", tasks: ["MANAGE_LEADS", "ADVERTISE"], access_token: tokenA },
            { id: pageB, name: "Other", tasks: ["ANALYZE"], access_token: tokenB },
          ],
        });
      }
      if (path === `${pageA}/leadgen_forms`) {
        assert.equal(bearer, `Bearer ${tokenA}`);
        return json({ error: { code: 190, message: `Invalid OAuth access token ${tokenA}` } }, 400);
      }
      if (path === `${pageB}/leadgen_forms`) {
        assert.equal(bearer, `Bearer ${tokenB}`);
        return json({ data: [{ id: "1149211490298917", name: "Form B", status: "ACTIVE" }] });
      }
      if (path === `${pageNear}/leadgen_forms`) {
        assert.equal(bearer, `Bearer ${tokenNear}`);
        return json({ data: [] });
      }
      if (path.endsWith("/subscribed_apps")) {
        const pageId = path.split("/")[0] ?? "";
        const expected = pageId === pageA ? tokenA : pageId === pageB ? tokenB : tokenNear;
        assert.equal(bearer, `Bearer ${expected}`);
        return json({ data: [{ id: "1641287293781686", name: "SA360", subscribed_fields: ["leadgen"] }] });
      }
      if (path === "me/adaccounts") {
        assert.equal(bearer, `Bearer ${system}`);
        return json({ data: [{ id: "act_99", name: "Ads", account_id: "99" }] });
      }
      if (path.startsWith("act_")) {
        assert.equal(bearer, `Bearer ${system}`);
        return json({ data: [] });
      }
      return json({ error: { code: 190, message: "unexpected path" } }, 400);
    },
  });

  assert.equal(calls.some((call) => call.path.startsWith(`${pageMissing}/`)), false);
  assert.equal(calls.filter((call) => call.path === `${pageA}/leadgen_forms`).length, 1);
  const pageAProof = createHmac("sha256", SECRET).update(tokenA, "utf8").digest("hex");
  const systemProof = createHmac("sha256", SECRET).update(system, "utf8").digest("hex");
  const formsCall = calls.find((call) => call.path === `${pageA}/leadgen_forms`);
  assert.equal(formsCall?.proof, pageAProof);
  assert.notEqual(formsCall?.proof, systemProof);
  assert.equal(discovery.pages.items.find((page) => page.id === pageA)?.tasks.includes("MANAGE_LEADS"), true);
  assert.equal("accessToken" in (discovery.pages.items[0] ?? {}), false);
  assert.equal(discovery.forms.items.length, 1);
  assert.equal(discovery.forms.items[0]?.pageId, pageB);
  assert.equal(discovery.forms.permissionDenied, true);
  assert.equal(discovery.subscriptions.items.some((item) => item.pageId === pageA && item.leadgenSubscribed), true);
  assert.equal(discoveryContainsSecret(discovery, system), false);
  assert.equal(discoveryContainsSecret(discovery, tokenA), false);
  assert.equal(discoveryContainsSecret(discovery, tokenB), false);
  assert.equal(discoveryContainsSecret(discovery, tokenNear), false);
  assert.equal(discoveryContainsSecret(discovery, SECRET), false);
  assert.match(discovery.forms.diagnostic ?? "", /190/);
  assert.equal((discovery.forms.diagnostic ?? "").includes(tokenA), false);
});

test("system user discovery does not call Page endpoints when /me/accounts is refused", async () => {
  const system = "EAABSystemUserRefusedTokenValueNotReal";
  const pageA = "222591640945329";
  const paths: string[] = [];
  const discovery = await discoverMetaAuthorizedAssets({
    credentialId: "cred_refused",
    accessToken: system,
    appSecret: SECRET,
    appId: "1641287293781686",
    credentialKind: "system_user",
    pageIds: [pageA],
    fetchImpl: async (url, init) => {
      const parsed = new URL(String(url));
      const path = parsed.pathname.replace(/^\/v25\.0\//, "");
      paths.push(path);
      const bearer = new Headers(init?.headers).get("authorization") ?? "";
      if (path === "me/accounts") assert.equal(bearer, `Bearer ${system}`);
      if (path.endsWith("/leadgen_forms") || path.endsWith("/subscribed_apps")) {
        assert.notEqual(bearer, `Bearer ${system}`);
      }
      if (path === "debug_token") {
        return json({
          data: { is_valid: false, type: "SYSTEM_USER", app_id: "1641287293781686" },
        });
      }
      if (path === "me/accounts") {
        return json({ error: { code: 190, message: `Invalid OAuth 2.0 Access Token ${system}` } }, 400);
      }
      return json({ error: { code: 190, message: "should not be called" } }, 400);
    },
  });
  assert.equal(paths.includes(`${pageA}/leadgen_forms`), false);
  assert.equal(paths.includes(`${pageA}/subscribed_apps`), false);
  assert.equal(paths.includes("me/adaccounts"), false);
  assert.equal(discovery.pages.permissionDenied, true);
  assert.equal(discovery.forms.permissionDenied, true);
  assert.equal(discovery.subscriptions.permissionDenied, true);
  assert.equal(discoveryContainsSecret(discovery, system), false);
  assert.match(discovery.forms.diagnostic ?? "", /190/);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
