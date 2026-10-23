import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS,
  COMPANY_SHEETS_DRAIN_MAX_EXECUTIONS,
  COMPANY_SHEETS_INTENT_BUDGET_MS,
  COMPANY_SHEETS_INTENT_HTTP_CALL_CEILING,
} from "@sa360/shared";

import { COMPANY_STORAGE_ANCESTRY_LIMIT } from "../company-google/company-google-storage-policy.js";

test("drain budget matches the ancestry cap and one execution", () => {
  const service = readFileSync(new URL("./company-sheets-dispatch.service.ts", import.meta.url), "utf8");
  const delivery = readFileSync(
    new URL("../company-sheets-delivery/company-sheets-delivery.service.ts", import.meta.url),
    "utf8"
  );
  const nonAncestryCalls = 1 + 1 + 1 + 3 + 1 + 8;
  assert.equal(COMPANY_STORAGE_ANCESTRY_LIMIT, 20);
  assert.equal(COMPANY_SHEETS_INTENT_HTTP_CALL_CEILING, nonAncestryCalls + COMPANY_STORAGE_ANCESTRY_LIMIT);
  assert.equal(COMPANY_SHEETS_DRAIN_MAX_EXECUTIONS, 1);
  assert.ok(COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS > COMPANY_SHEETS_INTENT_BUDGET_MS);
  assert.match(delivery, /maxBatches \?\? 4/);
  assert.match(delivery, /appendStartedAt/);
  assert.match(service, /COMPANY_SHEETS_DRAIN_MAX_EXECUTIONS/);
  assert.equal(service.includes("appendSheetValues"), false);
});
