import test from "node:test";
import assert from "node:assert/strict";
import {
  BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID,
  BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID,
  BULK_IMPORT_INITIAL_CANARY_MAX_ROWS,
} from "@sa360/shared";
import {
  INITIAL_CANARY_NON_DEMO_WARNING,
  isBulkImportInitialCanaryDemoOnlyEnabled,
  isCanonicalDemoBulkImportDestination,
  validateInitialBulkImportCanary,
} from "./bulk-import-initial-canary-guard.js";
import {
  isLiveAllowlistSimulationNoise,
  sanitizeSimulationRowResult,
} from "./bulk-import-wizard-metadata.service.js";
import {
  summarizeApprovedWaveRows,
} from "./bulk-import-delivery-completion.service.js";
import { getBulkImportWorkerDiagnostics } from "./bulk-import-queue-monitor.service.js";
import { isDirectLiveDeliveryEnvConfigured } from "../../lib/direct-demo-delivery-config.js";
import { validateLiveDeliveryDestination } from "./bulk-import-delivery.service.js";
import { parseBulkImportLiveDeliverySnapshot } from "./bulk-import-live-delivery-present.service.js";

test("non-demo initial canary is blocked before queueing", () => {
  const result = validateInitialBulkImportCanary({
    destinationClientAccountId: "vet_life_james_torrey",
    destinationLocationIdGhl: "other_location",
    importOptionsJson: { workflowStrategy: "source_tag_only" },
    rowLimit: 1,
    eligibleRows: [
      {
        id: "row_1",
        rowNumber: 1,
        deliveryStatus: "simulated",
        duplicateStatus: "none",
        ghlContactId: null,
        sourceLeadEventId: "evt_1",
        excluded: false,
      },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.blockers.some((b) => b.includes(INITIAL_CANARY_NON_DEMO_WARNING)));
  }
});

test("canonical demo destination may pass initial canary guard", () => {
  const result = validateInitialBulkImportCanary({
    destinationClientAccountId: BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID,
    destinationLocationIdGhl: BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID,
    importOptionsJson: { workflowStrategy: "source_tag_only" },
    rowLimit: 1,
    eligibleRows: [
      {
        id: "row_1",
        rowNumber: 1,
        deliveryStatus: "simulated",
        duplicateStatus: "none",
        ghlContactId: null,
        sourceLeadEventId: "evt_1",
        excluded: false,
      },
    ],
  });
  assert.equal(result.ok, true);
});

test("wave size greater than 1 is blocked for initial canary", () => {
  const result = validateInitialBulkImportCanary({
    destinationClientAccountId: BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID,
    destinationLocationIdGhl: BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID,
    importOptionsJson: { workflowStrategy: "source_tag_only" },
    rowLimit: 2,
    eligibleRows: [
      {
        id: "row_1",
        rowNumber: 1,
        deliveryStatus: "simulated",
        duplicateStatus: "none",
        ghlContactId: null,
        sourceLeadEventId: "evt_1",
        excluded: false,
      },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.blockers.some((b) => b.includes(String(BULK_IMPORT_INITIAL_CANARY_MAX_ROWS)))
    );
  }
});

test("source_tag_only is required for initial canary", () => {
  const result = validateInitialBulkImportCanary({
    destinationClientAccountId: BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID,
    destinationLocationIdGhl: BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID,
    importOptionsJson: { workflowStrategy: "trigger_new_lead" },
    rowLimit: 1,
    eligibleRows: [
      {
        id: "row_1",
        rowNumber: 1,
        deliveryStatus: "simulated",
        duplicateStatus: "none",
        ghlContactId: null,
        sourceLeadEventId: "evt_1",
        excluded: false,
      },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.blockers.some((b) => b.includes("source_tag_only")));
  }
});

test("initial canary guard can be disabled by rollout setting", () => {
  const previous = process.env.SA360_BULK_IMPORT_INITIAL_CANARY_DEMO_ONLY;
  process.env.SA360_BULK_IMPORT_INITIAL_CANARY_DEMO_ONLY = "false";
  try {
    assert.equal(isBulkImportInitialCanaryDemoOnlyEnabled(), false);
    const result = validateInitialBulkImportCanary({
      destinationClientAccountId: "other_client",
      destinationLocationIdGhl: "other_location",
      importOptionsJson: { workflowStrategy: "trigger_new_lead" },
      rowLimit: 5,
      eligibleRows: [],
    });
    assert.equal(result.ok, true);
  } finally {
    if (previous === undefined) delete process.env.SA360_BULK_IMPORT_INITIAL_CANARY_DEMO_ONLY;
    else process.env.SA360_BULK_IMPORT_INITIAL_CANARY_DEMO_ONLY = previous;
  }
});

test("canonical demo destination ids are exact", () => {
  assert.equal(
    isCanonicalDemoBulkImportDestination(
      BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID,
      BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID
    ),
    true
  );
  assert.equal(
    isCanonicalDemoBulkImportDestination("smart_agent_360_demo", "wrong"),
    false
  );
});

test("stale simulation allowlist warnings are cleared on successful simulation sanitize", () => {
  const sanitized = sanitizeSimulationRowResult({
    rowId: "row_1",
    rowNumber: 1,
    ok: true,
    reason: "Matched destination is not on the direct delivery allowlist.",
    blockers: ["Destination is not on the live delivery allowlist."],
    externalCallExecuted: false,
  });
  assert.equal(sanitized.status, "simulated");
  assert.equal(sanitized.reason, null);
  assert.equal(sanitized.blockers, undefined);
  assert.equal(
    isLiveAllowlistSimulationNoise("Matched destination is not on the direct delivery allowlist."),
    true
  );
});

test("fully successful approved wave becomes completed", () => {
  const summary = summarizeApprovedWaveRows(
    [
      { id: "row_1", deliveryStatus: "delivered", deliveryAttempts: 1 },
    ],
    ["row_1"]
  );
  assert.equal(summary.status, "completed");
  assert.equal(summary.delivered, 1);
  assert.equal(summary.failed, 0);
});

test("mixed delivered and failed wave becomes partial_success", () => {
  const summary = summarizeApprovedWaveRows(
    [
      { id: "row_1", deliveryStatus: "delivered", deliveryAttempts: 1 },
      { id: "row_2", deliveryStatus: "failed", deliveryAttempts: 1 },
    ],
    ["row_1", "row_2"]
  );
  assert.equal(summary.status, "partial_success");
});

test("all failed wave with zero delivered becomes failed", () => {
  const summary = summarizeApprovedWaveRows(
    [{ id: "row_1", deliveryStatus: "failed", deliveryAttempts: 1 }],
    ["row_1"]
  );
  assert.equal(summary.status, "failed");
  assert.equal(summary.delivered, 0);
});

test("in-progress wave remains delivery_running", () => {
  const summary = summarizeApprovedWaveRows(
    [
      { id: "row_1", deliveryStatus: "delivering", deliveryAttempts: 1 },
      { id: "row_2", deliveryStatus: "simulated", deliveryAttempts: 0 },
    ],
    ["row_1", "row_2"]
  );
  assert.equal(summary.status, "delivery_running");
});

test("worker configuration diagnostics never expose admin key", () => {
  const previousUrl = process.env.SA360_API_INTERNAL_URL;
  const previousKey = process.env.ADMIN_API_KEY;
  process.env.SA360_API_INTERNAL_URL = "http://api.internal.sa360.test";
  process.env.ADMIN_API_KEY = "super-secret-key";
  try {
    const diagnostics = getBulkImportWorkerDiagnostics();
    assert.equal(diagnostics.apiInternalHostnameConfigured, true);
    assert.equal(diagnostics.apiInternalHostname, "api.internal.sa360.test");
    assert.equal(diagnostics.adminKeyPresent, true);
    assert.equal(JSON.stringify(diagnostics).includes("super-secret-key"), false);
  } finally {
    if (previousUrl === undefined) delete process.env.SA360_API_INTERNAL_URL;
    else process.env.SA360_API_INTERNAL_URL = previousUrl;
    if (previousKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousKey;
  }
});

test("source_tag_only live delivery snapshot notes no trigger tags", () => {
  const snapshot = parseBulkImportLiveDeliverySnapshot(
    {
      contactIdGhl: "contact_123",
      opportunityIdGhl: "opp_456",
      destinationSubaccountIdGhl: BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID,
      liveRunId: "run_789",
      liveRunStepSummary: [
        {
          stepType: "create_or_update_contact",
          label: "Contact created",
          status: "succeeded",
          detail: "Contact created",
          httpStatus: 200,
          httpMethod: "POST",
          httpPath: "/contacts",
          errorMessage: null,
          externalId: "contact_123",
          requestBodyKeys: [],
          requestBodyPreview: null,
          configuredOwnerId: null,
          customFieldStampSummary: null,
        },
        {
          stepType: "add_tags",
          label: "Tags",
          status: "succeeded",
          detail: "source:goat",
          httpStatus: 200,
          httpMethod: "POST",
          httpPath: "/contacts/contact_123/tags",
          errorMessage: null,
          externalId: "contact_123",
          requestBodyKeys: [],
          requestBodyPreview: null,
          configuredOwnerId: null,
          customFieldStampSummary: null,
        },
      ],
    },
    "source_tag_only",
    new Date("2026-06-17T12:00:00.000Z")
  );
  assert.equal(snapshot?.ghlContactId, "contact_123");
  assert.equal(snapshot?.workflowTriggerNote, "No NEW_LEAD or AI_READY trigger tag was added.");
  assert.deepEqual(snapshot?.tagsAdded, ["source:goat"]);
});

test("explicit environment allowlist is required", () => {
  const prevClient = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevLocation = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  try {
    assert.equal(isDirectLiveDeliveryEnvConfigured(), false);
  } finally {
    if (prevClient === undefined) delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
    else process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = prevClient;
    if (prevLocation === undefined) delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
    else process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = prevLocation;
  }
});

test("live destination mismatch prevents delivery execution path", async () => {
  const result = await validateLiveDeliveryDestination(
    {
      clientAccountIdResolved: "other_client",
      destinationLocationIdResolved: "other_location",
    } as never,
    {
      destinationClientAccountId: BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID,
      destinationLocationIdGhl: BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID,
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "destination_mismatch");
  }
});

test("retries do not double-count delivered rows when summarizing wave", () => {
  const summary = summarizeApprovedWaveRows(
    [{ id: "row_1", deliveryStatus: "delivered", deliveryAttempts: 3 }],
    ["row_1"]
  );
  assert.equal(summary.delivered, 1);
  assert.equal(summary.status, "completed");
});
