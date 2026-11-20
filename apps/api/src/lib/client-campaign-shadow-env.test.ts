import assert from "node:assert/strict";
import test from "node:test";

import { isClientCampaignShadowResolutionEnabled } from "./client-campaign-shadow-env.js";
import {
  observeClientCampaignShadow,
  shadowFailureLogFields,
} from "../services/client-campaign-shadow/observe-client-campaign-shadow.js";

test("shadow resolution enables only for the exact string true", () => {
  assert.equal(isClientCampaignShadowResolutionEnabled({}), false);
  assert.equal(
    isClientCampaignShadowResolutionEnabled({ SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: "" }),
    false
  );
  assert.equal(
    isClientCampaignShadowResolutionEnabled({ SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: "TRUE" }),
    false
  );
  assert.equal(
    isClientCampaignShadowResolutionEnabled({ SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: "1" }),
    false
  );
  assert.equal(
    isClientCampaignShadowResolutionEnabled({ SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: "yes" }),
    false
  );
  assert.equal(
    isClientCampaignShadowResolutionEnabled({ SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: "on" }),
    false
  );
  assert.equal(
    isClientCampaignShadowResolutionEnabled({
      SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: " true ",
    }),
    true
  );
  assert.equal(
    isClientCampaignShadowResolutionEnabled({ SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: "true" }),
    true
  );
});

test("a disabled shadow flag returns before any database call", async () => {
  const db = new Proxy(
    {},
    {
      get() {
        throw new Error("shadow query");
      },
    }
  );
  const result = await observeClientCampaignShadow("event-1", {}, db as never);
  assert.deepEqual(result, { written: false, skipped: "disabled" });
});

test("a shadow failure log keeps the event id and drops the error message", () => {
  const err = new Error("lead@example.com 555-0100 token=secret");
  err.name = "PrismaClientKnownRequestError";
  const fields = shadowFailureLogFields("event-1", err);
  assert.deepEqual(fields, {
    sourceLeadEventId: "event-1",
    errorName: "PrismaClientKnownRequestError",
  });
  assert.equal(JSON.stringify(fields).includes("lead@example.com"), false);
  assert.equal(JSON.stringify(fields).includes("secret"), false);
});

test("a database failure while the flag is on does not write a decision", async () => {
  const db = {
    clientCampaignShadowDecision: {
      findUnique: async () => {
        throw Object.assign(new Error("lead@example.com"), { code: "timeout" });
      },
      create: async () => {
        throw new Error("create should not run");
      },
    },
  };
  await assert.rejects(
    () =>
      observeClientCampaignShadow(
        "event-1",
        { SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED: "true" },
        db as never
      ),
    (err: unknown) => {
      assert.equal(err instanceof Error && err.message.includes("lead@example.com"), true);
      return true;
    }
  );
});
