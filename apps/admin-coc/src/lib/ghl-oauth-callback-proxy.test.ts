import test from "node:test";
import assert from "node:assert/strict";

test("getSa360PublicApiBaseUrl strips trailing slash", async () => {
  const prev =
    process.env.NEXT_PUBLIC_SA360_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://sa360-sw6oq.ondigitalocean.app/";
  const { getSa360PublicApiBaseUrl } = await import("./sa360-public-api-base-url.ts");
  assert.equal(getSa360PublicApiBaseUrl(), "https://sa360-sw6oq.ondigitalocean.app");
  if (prev !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prev;
  else delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
});
