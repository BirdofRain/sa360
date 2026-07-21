import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import Fastify from "fastify";

import { adminFrontOfficeInventoryExplorerRoutes } from "./admin-front-office-inventory-explorer.js";
import {
  InventoryExplorerService,
  setInventoryExplorerServiceForTests,
} from "../services/inventory-explorer/inventory-explorer.service.js";
import { InventorySnapshotCache } from "../services/inventory-explorer/inventory-snapshot-cache.js";

const ADMIN_KEY = "test-admin-inventory-explorer-key";

describe("GET /admin/v1/front-office/inventory-explorer", () => {
  before(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    setInventoryExplorerServiceForTests(
      new InventoryExplorerService({ memoryCacheOnly: true })
    );
  });

  after(() => {
    setInventoryExplorerServiceForTests(null);
  });

  it("returns 401 without admin key", async () => {
    const app = Fastify();
    await app.register(adminFrontOfficeInventoryExplorerRoutes, {
      prefix: "/admin/v1",
    });
    const res = await app.inject({
      method: "GET",
      url: "/admin/v1/front-office/inventory-explorer",
    });
    assert.equal(res.statusCode, 401);
    await app.close();
  });

  it("returns fixture-backed read model with disabled write capabilities", async () => {
    const app = Fastify();
    await app.register(adminFrontOfficeInventoryExplorerRoutes, {
      prefix: "/admin/v1",
    });
    const res = await app.inject({
      method: "GET",
      url: "/admin/v1/front-office/inventory-explorer",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.niches.TRUCKER.snapshot.publishedTotals.combined, 18707);
    assert.equal(body.niches.VET.snapshot.publishedTotals.combined, 147349);
    assert.equal(body.capabilities.canCreateOrder, false);
    assert.equal(body.capabilities.canReserveInventory, false);
    assert.equal(body.capabilities.canRequestQuote, false);
    assert.equal(body.provenance.source, "fixture_csv");
    await app.close();
  });
});

// Keep cache import referenced for tree-shaken test builds that import modules.
void InventorySnapshotCache;
