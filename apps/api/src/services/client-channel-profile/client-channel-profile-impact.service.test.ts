import test from "node:test";
import assert from "node:assert/strict";
import { previewClientChannelProfileImpact } from "./client-channel-profile-impact.service.js";

/**
 * Without a configured database (no DATABASE_URL in the test runtime), the contact-index query
 * fails and the service must degrade gracefully to a safe "unavailable" result rather than throwing.
 */
test("impact preview returns safe unavailable result when contact index is unavailable", async () => {
  const preview = await previewClientChannelProfileImpact({
    clientAccountId: "client_without_index",
    applyScope: "NEW_LEADS_ONLY",
  });
  assert.equal(preview.available, false);
  assert.match(preview.message, /unavailable/i);
  assert.equal(preview.dataSource, null);
  assert.equal(preview.totalIndexedContacts, 0);
  assert.equal(preview.buckets.activeUnlockedLeadsAffected.count, null);
});
