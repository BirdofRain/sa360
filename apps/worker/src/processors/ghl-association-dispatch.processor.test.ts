import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "bullmq";

import { GHL_ASSOCIATION_DISPATCH_JOB } from "@sa360/shared";

import { processGhlAssociationDispatchJob } from "./ghl-association-dispatch.processor.js";

const job = { name: GHL_ASSOCIATION_DISPATCH_JOB } as Job;

test("flag off does not call the API", async () => {
  let posts = 0;
  const result = await processGhlAssociationDispatchJob(job, {
    env: {},
    postImpl: async () => {
      posts += 1;
      return { status: 200, body: "" };
    },
  });
  assert.equal(result.skipped, "service_disabled");
  assert.equal(posts, 0);
});

test("one enabled drain posts the recovery route once", async () => {
  const urls: string[] = [];
  const result = await processGhlAssociationDispatchJob(job, {
    env: {
      SA360_GHL_ONGOING_DELIVERY_ENABLED: "true",
      ADMIN_API_KEY: "test-admin",
      SA360_API_INTERNAL_URL: "http://127.0.0.1:3001",
    },
    postImpl: async (input) => {
      urls.push(input.url);
      assert.equal(input.headers["x-sa360-admin-key"], "test-admin");
      return { status: 200, body: "{\"ok\":true}" };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(urls, ["http://127.0.0.1:3001/admin/v1/ghl/internal/process-association-dispatch"]);
});
