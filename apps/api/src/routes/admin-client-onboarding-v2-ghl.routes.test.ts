import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import {
  adminClientOnboardingV2GhlRoutes,
  type OnboardingGhlRouteDeps,
} from "./admin-client-onboarding-v2-ghl.js";
import {
  applySelectTimeZoneSelection,
  type ClientGhlDestinationSnapshot,
  type DiscoveredWorkflow,
} from "../services/client-onboarding-v2/onboarding-ghl-workflow.js";

const ADMIN_KEY = "admin-key-onboarding-v2";
const CLIENT = "onb_fixture_client";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function workflowsFor(nameCount: number): DiscoveredWorkflow[] {
  if (nameCount === 0) return [{ id: "wf_other", name: "Welcome" }];
  if (nameCount === 1) return [{ id: "wf_select", name: "Select Time Zone" }];
  return [
    { id: "wf_a", name: "Select Time Zone" },
    { id: "wf_b", name: "select time zone" },
  ];
}

function memoryDeps(nameCount: number): {
  deps: OnboardingGhlRouteDeps;
  rows: Map<string, ClientGhlDestinationSnapshot>;
  reads: { discovery: number };
} {
  const rows = new Map<string, ClientGhlDestinationSnapshot>([
    [
      CLIENT,
      {
        clientAccountId: CLIENT,
        revision: 1,
        destinationWorkflowIdGhl: null,
        workflowTriggerMode: "tag_trigger",
        deliveryEnabled: false,
        clientCutoverApproved: false,
      },
    ],
    [
      "other_client",
      {
        clientAccountId: "other_client",
        revision: 4,
        destinationWorkflowIdGhl: "wf_keep",
        workflowTriggerMode: "tag_trigger",
        deliveryEnabled: true,
        clientCutoverApproved: true,
      },
    ],
  ]);
  const reads = { discovery: 0 };
  const deps: OnboardingGhlRouteDeps = {
    listWorkflows: async (clientAccountId) => {
      reads.discovery += 1;
      return {
        clientFound: rows.has(clientAccountId),
        workflows: clientAccountId === CLIENT ? workflowsFor(nameCount) : [],
      };
    },
    readDestination: async (clientAccountId) => rows.get(clientAccountId) ?? null,
    saveWorkflowSelection: async (clientAccountId, patch) => {
      const current = rows.get(clientAccountId);
      if (!current) throw new Error("missing destination");
      const next = applySelectTimeZoneSelection(current, patch);
      rows.set(clientAccountId, next);
      return next;
    },
  };
  return { deps, rows, reads };
}

async function withApp(deps: OnboardingGhlRouteDeps | undefined, flag: string | undefined) {
  const previousFlag = process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED;
  const previousAdmin = process.env.ADMIN_API_KEY;
  const previousAlias = process.env.SA360_ADMIN_KEY;
  if (flag === undefined) delete process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED;
  else process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED = flag;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  delete process.env.SA360_ADMIN_KEY;
  const app = Fastify({ logger: false });
  await app.register(adminClientOnboardingV2GhlRoutes, { prefix: "/admin/v1", deps });
  return {
    app,
    async restore() {
      if (previousFlag === undefined) delete process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED;
      else process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED = previousFlag;
      if (previousAdmin === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = previousAdmin;
      if (previousAlias === undefined) delete process.env.SA360_ADMIN_KEY;
      else process.env.SA360_ADMIN_KEY = previousAlias;
      await app.close();
    },
  };
}

test("workflow routes stay disabled and do not read discovery when the flag is off", async () => {
  const { deps, reads } = memoryDeps(1);
  const ctx = await withApp(deps, undefined);
  try {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/admin/v1/clients/${CLIENT}/onboarding/ghl-workflows`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, "onboarding_config_disabled");
    assert.equal(reads.discovery, 0);
    const almost = await ctx.app.inject({
      method: "GET",
      url: `/admin/v1/clients/${CLIENT}/onboarding/ghl-workflows`,
    });
    assert.equal(almost.statusCode, 404);
    process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED = "TRUE";
    const wrong = await ctx.app.inject({
      method: "GET",
      url: `/admin/v1/clients/${CLIENT}/onboarding/ghl-workflows`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(wrong.statusCode, 404);
    assert.equal(reads.discovery, 0);
  } finally {
    await ctx.restore();
  }
});

test("enabled workflow GET reports unique, missing, and ambiguous matches without a network call", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("live fetch");
  };
  try {
    for (const [count, status, error] of [
      [1, 200, null],
      [0, 404, "workflow_not_found"],
      [2, 409, "workflow_ambiguous"],
    ] as const) {
      const { deps } = memoryDeps(count);
      const ctx = await withApp(deps, "true");
      try {
        const missingKey = await ctx.app.inject({
          method: "GET",
          url: `/admin/v1/clients/${CLIENT}/onboarding/ghl-workflows`,
        });
        assert.equal(missingKey.statusCode, 401);
        const portal = await ctx.app.inject({
          method: "GET",
          url: `/admin/v1/clients/${CLIENT}/onboarding/ghl-workflows`,
          headers: {
            "x-sa360-admin-key": ADMIN_KEY,
            "x-sa360-client-portal-key": "portal-secret",
          },
        });
        assert.equal(portal.statusCode, 403);
        assert.equal(portal.json().error, "tenant_mismatch");
        const res = await ctx.app.inject({
          method: "GET",
          url: `/admin/v1/clients/${CLIENT}/onboarding/ghl-workflows`,
          headers: { "x-sa360-admin-key": ADMIN_KEY },
        });
        assert.equal(res.statusCode, status);
        const body = res.json();
        assert.equal(body.createdWorkflow, false);
        assert.equal(body.createdCustomField, false);
        if (error) {
          assert.equal(body.error, error);
          assert.equal(body.selectedWorkflowId, null);
        } else {
          assert.equal(body.workflowMatch, "unique");
          assert.equal(body.workflowId, "wf_select");
          assert.equal(body.workflowName, "Select Time Zone");
        }
      } finally {
        await ctx.restore();
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workflow PUT persists an injected in-memory selection and leaves the other client and delivery flags", async () => {
  const { deps, rows } = memoryDeps(1);
  const ctx = await withApp(deps, "true");
  try {
    const rejected = await ctx.app.inject({
      method: "PUT",
      url: `/admin/v1/clients/${CLIENT}/onboarding/ghl-workflow`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: {
        requestId: REQUEST_ID,
        expectedRevision: 1,
        discoveredWorkflowId: "wf_select",
        discoveredName: "Select Time Zone",
        deliveryEnabled: true,
      },
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal(rows.get(CLIENT)?.deliveryEnabled, false);
    assert.equal(rows.get(CLIENT)?.workflowTriggerMode, "tag_trigger");

    const stale = await ctx.app.inject({
      method: "PUT",
      url: `/admin/v1/clients/${CLIENT}/onboarding/ghl-workflow`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: {
        requestId: REQUEST_ID,
        expectedRevision: 1,
        discoveredWorkflowId: "wf_old",
        discoveredName: "Select Time Zone",
      },
    });
    assert.equal(stale.statusCode, 404);
    assert.equal(stale.json().error, "workflow_not_found");
    assert.equal(stale.json().persisted, false);
    assert.equal(rows.get(CLIENT)?.workflowTriggerMode, "tag_trigger");

    const saved = await ctx.app.inject({
      method: "PUT",
      url: `/admin/v1/clients/${CLIENT}/onboarding/ghl-workflow`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: {
        requestId: REQUEST_ID,
        expectedRevision: 1,
        discoveredWorkflowId: "wf_select",
        discoveredName: "Select Time Zone",
      },
    });
    assert.equal(saved.statusCode, 200);
    const body = saved.json();
    assert.equal(body.persisted, true);
    assert.equal(body.selection.workflowTriggerMode, "direct_api");
    assert.equal(body.selection.destinationWorkflowIdGhl, "wf_select");
    assert.equal(body.destination.deliveryEnabled, false);
    assert.equal(body.destination.clientCutoverApproved, false);
    assert.equal(body.createdCustomField, false);
    assert.equal(rows.get(CLIENT)?.workflowTriggerMode, "direct_api");
    assert.equal(rows.get(CLIENT)?.destinationWorkflowIdGhl, "wf_select");
    assert.equal(rows.get(CLIENT)?.deliveryEnabled, false);
    assert.equal(rows.get("other_client")?.workflowTriggerMode, "tag_trigger");
    assert.equal(rows.get("other_client")?.destinationWorkflowIdGhl, "wf_keep");
    assert.equal(rows.get("other_client")?.deliveryEnabled, true);
  } finally {
    await ctx.restore();
  }
});

test("workflow PUT without a destination writer returns the patch and does not persist", async () => {
  const { deps, rows } = memoryDeps(1);
  delete deps.saveWorkflowSelection;
  const ctx = await withApp(deps, "true");
  try {
    const res = await ctx.app.inject({
      method: "PUT",
      url: `/admin/v1/clients/${CLIENT}/onboarding/ghl-workflow`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: {
        requestId: REQUEST_ID,
        expectedRevision: 1,
        discoveredWorkflowId: "wf_select",
        discoveredName: "Select Time Zone",
      },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.persisted, false);
    assert.equal(body.integration, "pending_client_ghl_destination_write");
    assert.equal(body.selection.workflowTriggerMode, "direct_api");
    assert.ok(body.integrationRemaining.some((item: string) => item.includes("notesEnabled")));
    assert.equal(rows.get(CLIENT)?.workflowTriggerMode, "tag_trigger");
    assert.equal(rows.get(CLIENT)?.destinationWorkflowIdGhl, null);
  } finally {
    await ctx.restore();
  }
});

test("note preview returns evt_note_v2 text and does not post", async () => {
  const ctx = await withApp({}, "true");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("live fetch");
  };
  try {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/ghl-note-preview`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: {
        testRunId: "run_1",
        event: {
          sourceLeadEventId: "evt_note_v2",
          generatedAt: "2026-10-26T15:04:00.000Z",
          fullName: "Ada Lovelace",
          phone: "+15550100",
          email: "ada@example.com",
          state: "TX",
          leadType: "VET",
          sourceText: "leadcapture go.example.com/alex",
          sourceAttributes: {
            primary_reason: "Family",
            age: 47,
            date_of_birth: "1979-04-12",
            military_status: "",
            fbclid: "IwAR123",
          },
          schemaDrift: {
            possibleRenames: [
              { from: "Coverage Reason", to: "Primary Reason", canonical: "primary_reason" },
            ],
          },
          answerFields: [
            { key: "Primary Reason", value: "Family", canonicalKey: "primary_reason" },
            { key: "Age", value: "47", canonicalKey: "age" },
            { key: "DOB", value: "April 12, 1979", canonicalKey: "date_of_birth" },
            { key: "Military Status", value: "", canonicalKey: "military_status" },
            { key: "Beneficiary", value: "Child", canonicalKey: "beneficiary" },
            { key: "Beneficiary", value: "Spouse", canonicalKey: "beneficiary" },
            { key: "Desired Coverage", value: ["25000", "50000"], canonicalKey: "desired_coverage" },
            { key: "fbclid", value: "IwAR123" },
            { key: "xxTrustedFormCertUrl", value: "https://cert.example/secret" },
          ],
        },
      },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.posted, false);
    assert.equal(body.externalCalls.ghl, false);
    assert.equal(body.externalCalls.providerWebhook, false);
    assert.match(body.note.body, /SA360 test run: run_1/);
    assert.match(body.note.body, /Primary Reason \(was: Coverage Reason\): Family/);
    assert.match(body.note.body, /Primary concern: not supplied/);
    assert.equal(body.note.body.includes("IwAR123"), false);
    assert.equal(body.note.status, "ready");
  } finally {
    globalThis.fetch = originalFetch;
    await ctx.restore();
  }
});
