import test from "node:test";
import assert from "node:assert/strict";
import { getDefaultMasterClientAccountId } from "./master-client-default.ts";

test("getDefaultMasterClientAccountId reads NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID", () => {
  const prevSa360 = process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID;
  const prevLegacy = process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID;
  process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID = "lal_master_vet";
  delete process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID;
  assert.equal(getDefaultMasterClientAccountId(), "lal_master_vet");
  if (prevSa360 !== undefined) {
    process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID = prevSa360;
  } else {
    delete process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID;
  }
  if (prevLegacy !== undefined) {
    process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID = prevLegacy;
  }
});

test("getDefaultMasterClientAccountId falls back to legacy env when SA360 default unset", () => {
  const prevSa360 = process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID;
  const prevLegacy = process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID;
  delete process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID;
  process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID = "legacy_master";
  assert.equal(getDefaultMasterClientAccountId(), "legacy_master");
  if (prevSa360 !== undefined) {
    process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID = prevSa360;
  }
  if (prevLegacy !== undefined) {
    process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID = prevLegacy;
  } else {
    delete process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID;
  }
});

test("getDefaultMasterClientAccountId returns empty when env missing", () => {
  const prevSa360 = process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID;
  const prevLegacy = process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID;
  delete process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID;
  delete process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID;
  assert.equal(getDefaultMasterClientAccountId(), "");
  if (prevSa360 !== undefined) {
    process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID = prevSa360;
  }
  if (prevLegacy !== undefined) {
    process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID = prevLegacy;
  }
});
