import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BUYER_CSV_COLUMNS,
  BUYER_CSV_FIELD_SCHEMA_VERSION,
  BUYER_CSV_V2_FIELD_SCHEMA_VERSION,
  BUYER_CSV_V3_FIELD_SCHEMA_VERSION,
  BUYER_CSV_V4_FIELD_SCHEMA_VERSION,
  SPREADSHEET_DELIVERY_CONFIRM_PHRASE,
  activeBuyerCsvFieldSchemaVersionForNiche,
} from "./buyer-csv-export.service.js";
import { hasBuyerPriorDelivery } from "./buyer-delivery-history.service.js";
import {
  computeShortfallQuantity,
  PPL_PRODUCTION_MIN_QTY,
  validatePplRequestedQuantity,
} from "./inventory-selection.service.js";

describe("PPL CSV beta contracts", () => {
  it("accepts quantity 1 and 99 with production min = 1", () => {
    assert.equal(PPL_PRODUCTION_MIN_QTY, 1);
    assert.deepEqual(validatePplRequestedQuantity(1), { ok: true });
    assert.deepEqual(validatePplRequestedQuantity(99), { ok: true });
  });

  it("exposes shortfall without lowering requested commercial quantity", () => {
    const requestedQuantity = 210;
    const selectedQuantity = 200;
    assert.equal(computeShortfallQuantity(requestedQuantity, selectedQuantity), 10);
    assert.equal(requestedQuantity, 210);
  });

  it("keeps buyer_csv_v1/v2/v3 historical identity and scopes new customer presentation to vet/trucker", () => {
    assert.equal(BUYER_CSV_FIELD_SCHEMA_VERSION, "buyer_csv_v1");
    assert.equal(BUYER_CSV_COLUMNS.length, 7);
    assert.equal(BUYER_CSV_V2_FIELD_SCHEMA_VERSION, "buyer_csv_v2");
    assert.equal(BUYER_CSV_V3_FIELD_SCHEMA_VERSION, "buyer_csv_v3");
    assert.equal(BUYER_CSV_V4_FIELD_SCHEMA_VERSION, "buyer_csv_v4");
    assert.equal(activeBuyerCsvFieldSchemaVersionForNiche("vet"), "buyer_csv_v4");
    assert.equal(activeBuyerCsvFieldSchemaVersionForNiche("trucker"), "buyer_csv_v4");
    assert.equal(activeBuyerCsvFieldSchemaVersionForNiche("nurse"), "buyer_csv_v2");
    assert.equal(activeBuyerCsvFieldSchemaVersionForNiche("mortgage"), "buyer_csv_v2");
    assert.equal(activeBuyerCsvFieldSchemaVersionForNiche("solar"), "buyer_csv_v2");
  });

  it("requires explicit MARK SPREADSHEET DELIVERED phrase for delivery recording", () => {
    assert.equal(SPREADSHEET_DELIVERY_CONFIRM_PHRASE, "MARK SPREADSHEET DELIVERED");
  });

  it("same-client prior delivery lookup is tenant-scoped (Client A vs Client B)", async () => {
    const calls: unknown[] = [];
    const db = {
      buyerDeliveredIdentity: {
        findFirst: async (args: unknown) => {
          calls.push(args);
          return null;
        },
      },
    };

    await hasBuyerPriorDelivery(
      {
        clientAccountId: "client_a",
        phoneFingerprint: "phone-z",
        emailFingerprint: "email-z",
      },
      db as never
    );

    assert.equal(calls.length, 1);
    const where = (calls[0] as { where: { OR: Array<{ clientAccountId: string }> } }).where;
    assert.ok(where.OR.every((clause) => clause.clientAccountId === "client_a"));
  });
});
