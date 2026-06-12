import test from "node:test";
import assert from "node:assert/strict";
import { formatDeployVersionsLine, getAdminBuildVersion } from "./build-version.ts";

test("formatDeployVersionsLine shows admin and API short SHAs", () => {
  const line = formatDeployVersionsLine(
    { commitShort: "608c761", commitSha: "608c761abc", buildLabel: null },
    { commitShort: "608c761", commitSha: "608c761abc", buildLabel: null }
  );
  assert.equal(line, "Deploy versions: Admin 608c761 · API 608c761");
});

test("formatDeployVersionsLine falls back to unknown", () => {
  const line = formatDeployVersionsLine(null, null);
  assert.equal(line, "Deploy versions: Admin unknown · API unknown");
});

test("getAdminBuildVersion reads NEXT_PUBLIC_SA360_BUILD_COMMIT_SHORT", () => {
  const prev = process.env.NEXT_PUBLIC_SA360_BUILD_COMMIT_SHORT;
  process.env.NEXT_PUBLIC_SA360_BUILD_COMMIT_SHORT = "abc1234";
  try {
    assert.equal(getAdminBuildVersion().commitShort, "abc1234");
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SA360_BUILD_COMMIT_SHORT;
    else process.env.NEXT_PUBLIC_SA360_BUILD_COMMIT_SHORT = prev;
  }
});
