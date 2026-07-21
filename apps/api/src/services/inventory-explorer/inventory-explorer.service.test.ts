import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Redis } from "ioredis";

import { FileInventorySnapshotProvider } from "./file-inventory-snapshot-provider.js";
import { GoogleSheetsInventorySnapshotProvider } from "./google-sheets-inventory-provider.js";
import {
  GOOGLE_SHEETS_READONLY_SCOPE,
  GoogleSheetsReadOnlyClient,
  isGoogleSheetsInventoryProviderEnabled,
  readGoogleSheetsConfigFromEnv,
} from "./google-sheets-client.js";
import { InventoryExplorerService } from "./inventory-explorer.service.js";
import { inventoryCacheKey } from "./inventory-explorer.types.js";
import { InventorySnapshotCache } from "./inventory-snapshot-cache.js";

function loadFixture(name: "trucker" | "vet"): string {
  const relative =
    name === "trucker"
      ? "docs/demo/inventory/trucker-inventory-2026-07-20.csv"
      : "docs/demo/inventory/vet-inventory-2026-07-20.csv";
  const candidates = [
    join(process.cwd(), relative),
    join(process.cwd(), "../../", relative),
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // try next
    }
  }
  return readFileSync(candidates[0]!, "utf8");
}

const INVALID_CSV = `Fast Lead Export Inventory Report,,,,
Version,5.0.0,,,
Source Sheet,Bad,,,
Started At,7/20/2026,,,
Completed At,7/20/2026,,,
,,,,
Bucket Totals,,,,
Lead Age Bucket,Available Leads,,,
1-3 months,1,,,
3-6 months,0,,,
6+ months,0,,,
,,,,
State Breakdown,,,,
State,first_name,phone,email,lead_id
TX,Ada,555,a@b.com,lead_1
`;

function failingRedis(): Redis {
  return {
    get: async () => {
      throw new Error("redis down");
    },
    set: async () => {
      throw new Error("redis down");
    },
    del: async () => {
      throw new Error("redis down");
    },
  } as unknown as Redis;
}

describe("FileInventorySnapshotProvider", () => {
  it("returns authoritative Trucker and VET snapshot totals", async () => {
    const provider = new FileInventorySnapshotProvider();
    const trucker = await provider.getSnapshot({ nicheKey: "TRUCKER" });
    const vet = await provider.getSnapshot({ nicheKey: "VET" });

    assert.equal(trucker.bundle.snapshot.publishedTotals.combined, 18707);
    assert.equal(trucker.bundle.snapshot.mappedTotals.combined, 18661);
    assert.equal(trucker.bundle.snapshot.unmappedTotals.combined, 46);
    assert.equal(vet.bundle.snapshot.publishedTotals.combined, 147349);
    assert.equal(vet.bundle.snapshot.mappedTotals.combined, 147094);
    assert.equal(vet.bundle.snapshot.unmappedTotals.combined, 255);
    assert.equal(trucker.provenance.source, "fixture_csv");
    assert.equal(trucker.cacheEligible, true);
  });

  it("keeps write capabilities disabled on assembled read model", async () => {
    const service = new InventoryExplorerService({ memoryCacheOnly: true });
    const model = await service.getReadModel();
    assert.equal(model.capabilities.canCreateOrder, false);
    assert.equal(model.capabilities.canReserveInventory, false);
    assert.equal(model.capabilities.canRequestQuote, false);
    assert.equal(model.provenance.source, "fixture_csv");
    assert.equal(model.provenance.freshness, "fallback");
  });
});

describe("InventorySnapshotCache", () => {
  it("uses niche-isolated keys inventory-explorer:snapshot:v1:{niche}", () => {
    assert.equal(
      inventoryCacheKey("TRUCKER"),
      "inventory-explorer:snapshot:v1:TRUCKER"
    );
    assert.equal(inventoryCacheKey("VET"), "inventory-explorer:snapshot:v1:VET");
  });

  it("never stores non-cache-eligible snapshots", async () => {
    const cache = new InventorySnapshotCache(null);
    const file = new FileInventorySnapshotProvider();
    const valid = await file.getSnapshot({ nicheKey: "TRUCKER" });
    const stored = await cache.set("TRUCKER", {
      ...valid,
      cacheEligible: false,
    });
    assert.equal(stored, false);
    assert.equal(await cache.get("TRUCKER"), null);
  });

  it("isolates VET and Trucker cache keys", async () => {
    const cache = new InventorySnapshotCache(null);
    const file = new FileInventorySnapshotProvider();
    const trucker = await file.getSnapshot({ nicheKey: "TRUCKER" });
    const vet = await file.getSnapshot({ nicheKey: "VET" });
    await cache.set("TRUCKER", trucker);
    await cache.set("VET", vet);
    const cachedTrucker = await cache.get("TRUCKER");
    const cachedVet = await cache.get("VET");
    assert.equal(
      cachedTrucker?.snapshot.bundle.snapshot.publishedTotals.combined,
      18707
    );
    assert.equal(
      cachedVet?.snapshot.bundle.snapshot.publishedTotals.combined,
      147349
    );
  });

  it("remains safe when Redis get/set fail (L1 path)", async () => {
    const cache = new InventorySnapshotCache(failingRedis());
    const file = new FileInventorySnapshotProvider();
    const valid = await file.getSnapshot({ nicheKey: "TRUCKER" });
    const stored = await cache.set("TRUCKER", valid);
    assert.equal(stored, true);
    const hit = await cache.get("TRUCKER");
    assert.equal(hit?.snapshot.bundle.snapshot.publishedTotals.combined, 18707);
  });
});

describe("feature flag disabled", () => {
  it("makes zero Google client fetch attempts and serves fixtures", async () => {
    const prev = process.env.INVENTORY_SHEETS_PROVIDER_ENABLED;
    const prevEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    delete process.env.INVENTORY_SHEETS_PROVIDER_ENABLED;
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL = "should-not-be-used@example.com";
    process.env.GOOGLE_SHEETS_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n";
    process.env.INVENTORY_SHEETS_TRUCKER_SPREADSHEET_ID = "t";
    process.env.INVENTORY_SHEETS_VET_SPREADSHEET_ID = "v";

    try {
      assert.equal(isGoogleSheetsInventoryProviderEnabled(), false);
      const sheets = new GoogleSheetsInventorySnapshotProvider();
      assert.equal(sheets.isEnabled(), false);
      assert.equal(sheets.getGoogleFetchAttemptCount(), 0);

      const service = new InventoryExplorerService({
        sheetsProvider: sheets,
        memoryCacheOnly: true,
      });
      const model = await service.getReadModel({ forceRefresh: true });
      assert.equal(sheets.getGoogleFetchAttemptCount(), 0);
      assert.equal(model.niches.TRUCKER.snapshot.publishedTotals.combined, 18707);
      assert.equal(model.niches.TRUCKER.snapshot.mappedTotals.combined, 18661);
      assert.equal(model.niches.TRUCKER.snapshot.unmappedTotals.combined, 46);
      assert.equal(model.niches.VET.snapshot.publishedTotals.combined, 147349);
      assert.equal(model.niches.VET.snapshot.mappedTotals.combined, 147094);
      assert.equal(model.niches.VET.snapshot.unmappedTotals.combined, 255);
      assert.equal(model.provenance.source, "fixture_csv");
    } finally {
      if (prev === undefined) delete process.env.INVENTORY_SHEETS_PROVIDER_ENABLED;
      else process.env.INVENTORY_SHEETS_PROVIDER_ENABLED = prev;
      if (prevEmail === undefined) delete process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
      else process.env.GOOGLE_SHEETS_CLIENT_EMAIL = prevEmail;
      delete process.env.GOOGLE_SHEETS_PRIVATE_KEY;
      delete process.env.INVENTORY_SHEETS_TRUCKER_SPREADSHEET_ID;
      delete process.env.INVENTORY_SHEETS_VET_SPREADSHEET_ID;
    }
  });
});

describe("InventoryExplorerService fallback matrix", () => {
  it("uses cached snapshot when Sheets returns invalid data (does not overwrite)", async () => {
    const cache = new InventorySnapshotCache(null);
    const file = new FileInventorySnapshotProvider();
    const valid = await file.getSnapshot({ nicheKey: "TRUCKER" });
    await cache.set("TRUCKER", {
      ...valid,
      provenance: {
        ...valid.provenance,
        source: "google_sheets",
        freshness: "fresh",
        fallbackStatus: "none",
      },
    });

    let calls = 0;
    const sheets = new GoogleSheetsInventorySnapshotProvider({
      enabled: true,
      fetchCsv: async () => {
        calls += 1;
        return INVALID_CSV;
      },
    });

    const service = new InventoryExplorerService({
      sheetsProvider: sheets,
      fileProvider: file,
      cache,
      memoryCacheOnly: true,
    });

    const result = await service.getSnapshot({ nicheKey: "TRUCKER" });
    assert.equal(calls, 1);
    assert.equal(result.provenance.source, "cached_google_sheets");
    assert.equal(result.bundle.snapshot.publishedTotals.combined, 18707);
    assert.equal(result.provenance.fallbackStatus, "sheets_invalid");

    const stillCached = await cache.get("TRUCKER");
    assert.equal(
      stillCached?.snapshot.bundle.snapshot.publishedTotals.combined,
      18707
    );
  });

  it("uses fixture when Sheets is down and cache is empty", async () => {
    const sheets = new GoogleSheetsInventorySnapshotProvider({
      enabled: true,
      fetchCsv: async () => {
        throw new Error("Sheets outage");
      },
    });
    const service = new InventoryExplorerService({
      sheetsProvider: sheets,
      cache: new InventorySnapshotCache(null),
      memoryCacheOnly: true,
    });
    const result = await service.getSnapshot({ nicheKey: "VET" });
    assert.equal(result.provenance.source, "fixture_csv");
    assert.equal(result.bundle.snapshot.publishedTotals.combined, 147349);
  });

  it("uses cached snapshot on Sheets outage", async () => {
    const cache = new InventorySnapshotCache(null);
    const file = new FileInventorySnapshotProvider();
    const valid = await file.getSnapshot({ nicheKey: "VET" });
    await cache.set("VET", valid);

    const sheets = new GoogleSheetsInventorySnapshotProvider({
      enabled: true,
      fetchCsv: async () => {
        throw new Error("Sheets outage");
      },
    });
    const service = new InventoryExplorerService({
      sheetsProvider: sheets,
      fileProvider: file,
      cache,
      memoryCacheOnly: true,
    });
    const result = await service.getSnapshot({ nicheKey: "VET" });
    assert.equal(result.provenance.source, "cached_google_sheets");
    assert.equal(result.provenance.fallbackStatus, "sheets_unavailable");
    assert.equal(result.bundle.snapshot.publishedTotals.combined, 147349);
  });

  it("forceRefresh does not destroy last valid cached snapshot", async () => {
    const cache = new InventorySnapshotCache(null);
    const file = new FileInventorySnapshotProvider();
    const valid = await file.getSnapshot({ nicheKey: "TRUCKER" });
    await cache.set("TRUCKER", valid);

    const sheets = new GoogleSheetsInventorySnapshotProvider({
      enabled: true,
      fetchCsv: async () => {
        throw new Error("Sheets outage during force refresh");
      },
    });
    const service = new InventoryExplorerService({
      sheetsProvider: sheets,
      fileProvider: file,
      cache,
      memoryCacheOnly: true,
    });

    const result = await service.getSnapshot({
      nicheKey: "TRUCKER",
      forceRefresh: true,
    });
    assert.equal(result.provenance.source, "cached_google_sheets");
    assert.equal(result.bundle.snapshot.publishedTotals.combined, 18707);
    const still = await cache.get("TRUCKER");
    assert.equal(still?.snapshot.bundle.snapshot.publishedTotals.combined, 18707);
  });

  it("parses valid aggregate summary from Sheets-injected CSV", async () => {
    const sheets = new GoogleSheetsInventorySnapshotProvider({
      enabled: true,
      fetchCsv: async (niche) =>
        niche === "TRUCKER" ? loadFixture("trucker") : loadFixture("vet"),
    });
    const service = new InventoryExplorerService({
      sheetsProvider: sheets,
      cache: new InventorySnapshotCache(null),
      memoryCacheOnly: true,
    });
    const result = await service.getSnapshot({ nicheKey: "TRUCKER" });
    assert.equal(result.provenance.source, "google_sheets");
    assert.equal(result.provenance.freshness, "fresh");
    assert.equal(result.bundle.snapshot.publishedTotals.combined, 18707);
    assert.equal(result.bundle.snapshot.mappedTotals.combined, 18661);
  });
});

describe("Google Sheets client safety", () => {
  it("exposes readonly scope only and has no write methods", () => {
    const client = new GoogleSheetsReadOnlyClient({
      clientEmail: "sa@example.com",
      privateKey:
        "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
      truckerSpreadsheetId: "t",
      vetSpreadsheetId: "v",
      summaryTab: "Inventory Summary",
    });
    assert.deepEqual(client.scopes, [GOOGLE_SHEETS_READONLY_SCOPE]);
    const proto = Object.getOwnPropertyNames(
      Object.getPrototypeOf(client) as object
    );
    assert.ok(!proto.includes("appendValues"));
    assert.ok(!proto.includes("updateValues"));
    assert.ok(!proto.includes("batchUpdate"));
    assert.ok(!proto.includes("clearValues"));
  });

  it("normalizes escaped private-key newlines from env", () => {
    const prev = { ...process.env };
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL = "sa@example.com";
    process.env.GOOGLE_SHEETS_PRIVATE_KEY =
      "-----BEGIN PRIVATE KEY-----\\nLINE\\n-----END PRIVATE KEY-----\\n";
    process.env.INVENTORY_SHEETS_TRUCKER_SPREADSHEET_ID = "t";
    process.env.INVENTORY_SHEETS_VET_SPREADSHEET_ID = "v";
    try {
      const cfg = readGoogleSheetsConfigFromEnv();
      assert.ok(cfg);
      assert.ok(cfg!.privateKey.includes("\nLINE\n"));
      assert.ok(!cfg!.privateKey.includes("\\n"));
    } finally {
      process.env.GOOGLE_SHEETS_CLIENT_EMAIL = prev.GOOGLE_SHEETS_CLIENT_EMAIL;
      process.env.GOOGLE_SHEETS_PRIVATE_KEY = prev.GOOGLE_SHEETS_PRIVATE_KEY;
      process.env.INVENTORY_SHEETS_TRUCKER_SPREADSHEET_ID =
        prev.INVENTORY_SHEETS_TRUCKER_SPREADSHEET_ID;
      process.env.INVENTORY_SHEETS_VET_SPREADSHEET_ID =
        prev.INVENTORY_SHEETS_VET_SPREADSHEET_ID;
    }
  });

  it("rejects raw lead column layouts as invalid", async () => {
    const sheets = new GoogleSheetsInventorySnapshotProvider({
      enabled: true,
      fetchCsv: async () => INVALID_CSV,
    });
    await assert.rejects(
      () => sheets.getSnapshot({ nicheKey: "TRUCKER" }),
      /Invalid aggregate inventory summary|Unexpected sensitive columns|State Breakdown/
    );
  });
});
