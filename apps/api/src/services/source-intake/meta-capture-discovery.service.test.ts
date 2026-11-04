import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverMetaAuthorizedAssets,
  discoveryContainsSecret,
} from "./meta-capture-discovery.service.js";

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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
