import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("delivery health monitoring does not execute Sheets delivery or read lead payloads", () => {
  const scan = readFileSync(new URL("./scan.ts", import.meta.url), "utf8");
  const rules = readFileSync(new URL("./rules.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../routes/admin-delivery-health.ts", import.meta.url), "utf8");
  for (const source of [scan, rules, route]) {
    assert.equal(source.includes("executeCompanySheetsDeliveryJob"), false);
    assert.equal(source.includes("appendSheetValues"), false);
    assert.equal(source.includes("googleapis"), false);
    assert.equal(source.includes("sourceLeadEvent.update"), false);
    assert.equal(source.includes("companySheetsDeliveryJob.update"), false);
    assert.equal(source.includes("companySheetsDispatchIntent.update"), false);
    assert.equal(source.includes("rawPayloadJson"), false);
    assert.equal(source.includes("valuesJson"), false);
    assert.equal(source.includes("requestBodyRedacted"), false);
  }
  assert.match(scan, /canonicalCompanySheetsDelivery/);
  assert.match(scan, /sendTransactionalEmail/);
  assert.match(route, /SA360_DELIVERY_HEALTH_MONITOR_ENABLED|monitorEnabled/);
});
