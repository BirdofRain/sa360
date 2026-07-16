import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

test("loadLeadInventoryPageData returns empty state when admin API unconfigured", async () => {
  const prevUrl = process.env.ADMIN_API_BASE_URL;
  const prevKey = process.env.ADMIN_API_KEY;
  delete process.env.ADMIN_API_BASE_URL;
  delete process.env.ADMIN_API_KEY;
  try {
    const { loadLeadInventoryPageData } = await import("./lead-inventory-api.ts");
    const result = await loadLeadInventoryPageData();
    assert.equal(result.dataSource, "empty");
    assert.equal(result.facets.length, 0);
    assert.ok(result.loadError);
  } finally {
    if (prevUrl !== undefined) process.env.ADMIN_API_BASE_URL = prevUrl;
    if (prevKey !== undefined) process.env.ADMIN_API_KEY = prevKey;
  }
});
