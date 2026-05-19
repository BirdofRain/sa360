import test from "node:test";
import assert from "node:assert/strict";
import { buildLeadTimelineQueryString, leadTimelinePageHref } from "./lead-timeline-query.ts";

test("buildLeadTimelineQueryString includes requestId and client scope", () => {
  const qs = buildLeadTimelineQueryString({
    requestId: "wh-log-abc",
    clientAccountId: "client_demo",
    leadUid: "lead_1",
    sort: "asc",
  });
  assert.match(qs, /requestId=wh-log-abc/);
  assert.match(qs, /clientAccountId=client_demo/);
  assert.match(qs, /leadUid=lead_1/);
});

test("leadTimelinePageHref builds path", () => {
  assert.equal(leadTimelinePageHref({ requestId: "x" }), "/lead-timeline?requestId=x");
});
