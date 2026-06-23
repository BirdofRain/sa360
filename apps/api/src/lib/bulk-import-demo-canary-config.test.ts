import assert from "node:assert/strict";
import test from "node:test";
import {
  isBulkImportInitialCanaryDestination,
  resolveBulkImportInitialCanaryDemoClientId,
} from "./bulk-import-demo-canary-config.js";

test("single allowlist entry resolves initial canary demo client id", () => {
  const prevClient = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevExplicit = process.env.SA360_BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID;
  delete process.env.SA360_BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = "smart_agent_360_demo_2";
  try {
    assert.equal(resolveBulkImportInitialCanaryDemoClientId(), "smart_agent_360_demo_2");
    assert.equal(
      isBulkImportInitialCanaryDestination("smart_agent_360_demo_2", "VPuMIhN6JpxdoXvvlekZ"),
      true
    );
    assert.equal(
      isBulkImportInitialCanaryDestination("smart_agent_360_demo", "VPuMIhN6JpxdoXvvlekZ"),
      false
    );
  } finally {
    if (prevClient === undefined) delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
    else process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = prevClient;
    if (prevExplicit === undefined) delete process.env.SA360_BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID;
    else process.env.SA360_BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID = prevExplicit;
  }
});
