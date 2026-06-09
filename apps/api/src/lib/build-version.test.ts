import test from "node:test";
import assert from "node:assert/strict";
import { getBuildVersionInfo, getBuildVersionPayload } from "./build-version.js";

test("getBuildVersionInfo reads COMMIT_HASH env", () => {
  const prev = process.env.COMMIT_HASH;
  process.env.COMMIT_HASH = "4cfddf0b06b22f6c72b7ae1390c79ebe45520141";
  const info = getBuildVersionInfo();
  assert.equal(info.commitShort, "4cfddf0");
  assert.equal(info.source, "COMMIT_HASH");
  if (prev !== undefined) process.env.COMMIT_HASH = prev;
  else delete process.env.COMMIT_HASH;
});

test("getBuildVersionPayload is safe for health JSON", () => {
  const payload = getBuildVersionPayload();
  assert.ok("commitSha" in payload);
  assert.ok(!JSON.stringify(payload).toLowerCase().includes("token"));
});
