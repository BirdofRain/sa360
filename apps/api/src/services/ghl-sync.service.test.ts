import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWhatHappenedGhlPlan,
  runWhatHappenedGhlSync,
  SA360_GHL_EVENT_TAGS,
  SA360_GHL_STATUS_TAGS,
} from "./ghl-sync.service.js";

test("buildWhatHappenedGhlPlan maps appointment_set to tags and fields", () => {
  const plan = buildWhatHappenedGhlPlan({
    clientAccountId: "c1",
    locationId: "loc1",
    contactIdGhl: "ct1",
    outcome: "appointment_set",
    notes: "Booked 3pm",
    metadata: { agentEmail: "agent@example.com" },
  });
  assert.ok(plan.tagsToAdd.includes(SA360_GHL_EVENT_TAGS.APPOINTMENT_SET));
  assert.equal(plan.fieldValues.sa360_appointment_status, "Set");
  assert.ok(plan.noteBody.includes("appointment_set"));
  assert.ok(plan.noteBody.includes("Booked 3pm"));
});

test("buildWhatHappenedGhlPlan not_interested adds DEAD tag", () => {
  const plan = buildWhatHappenedGhlPlan({
    clientAccountId: "c1",
    locationId: "loc1",
    contactIdGhl: "ct1",
    outcome: "not_interested",
  });
  assert.ok(plan.tagsToAdd.includes(SA360_GHL_STATUS_TAGS.DEAD));
});

test("runWhatHappenedGhlSync skips when sync disabled", async () => {
  const prev = process.env.AGENT_WORKSPACE_GHL_SYNC_ENABLED;
  delete process.env.AGENT_WORKSPACE_GHL_SYNC_ENABLED;
  const res = await runWhatHappenedGhlSync(
    {
      clientAccountId: "c1",
      locationId: "loc1",
      contactIdGhl: "ct1",
      outcome: "no_answer",
    },
    { fetch: globalThis.fetch }
  );
  assert.equal(res.attempted, false);
  assert.equal(res.finalStatus, "SYNCED");
  if (prev !== undefined) process.env.AGENT_WORKSPACE_GHL_SYNC_ENABLED = prev;
});

test("runWhatHappenedGhlSync fails fast when enabled without token", async () => {
  const prevE = process.env.AGENT_WORKSPACE_GHL_SYNC_ENABLED;
  const prevT = process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN;
  const prevG = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  process.env.AGENT_WORKSPACE_GHL_SYNC_ENABLED = "true";
  delete process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN;
  delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  const res = await runWhatHappenedGhlSync(
    {
      clientAccountId: "c1",
      locationId: "loc1",
      contactIdGhl: "ct1",
      outcome: "other",
    },
    { fetch: globalThis.fetch }
  );
  assert.equal(res.finalStatus, "FAILED");
  assert.equal(res.attempted, true);
  if (prevE !== undefined) process.env.AGENT_WORKSPACE_GHL_SYNC_ENABLED = prevE;
  else delete process.env.AGENT_WORKSPACE_GHL_SYNC_ENABLED;
  if (prevT !== undefined) process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN = prevT;
  if (prevG !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevG;
});

test("runWhatHappenedGhlSync uses mock fetch for happy-path note", async () => {
  const prevE = process.env.AGENT_WORKSPACE_GHL_SYNC_ENABLED;
  const prevPit = process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN;
  const prevJson = process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;
  process.env.AGENT_WORKSPACE_GHL_SYNC_ENABLED = "true";
  process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN = "pit_test_token";
  delete process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;

  const calls: { method: string; url: string }[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    if (method === "POST" && url.includes("/notes")) {
      return new Response(JSON.stringify({ ok: true, id: "note1" }), { status: 201 });
    }
    if (method === "POST" && url.endsWith("/tags")) {
      return new Response(JSON.stringify({ tags: [] }), { status: 201 });
    }
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
  };

  const res = await runWhatHappenedGhlSync(
    {
      clientAccountId: "c1",
      locationId: "loc_x",
      contactIdGhl: "ct_y",
      outcome: "no_answer",
      notes: "vm full",
    },
    { fetch: mockFetch }
  );

  assert.equal(res.finalStatus, "SYNCED");
  assert.ok(calls.some((c) => c.method === "POST" && c.url.includes("/notes")));
  assert.ok(calls.some((c) => c.method === "POST" && c.url.includes("/tags")));

  if (prevE !== undefined) process.env.AGENT_WORKSPACE_GHL_SYNC_ENABLED = prevE;
  else delete process.env.AGENT_WORKSPACE_GHL_SYNC_ENABLED;
  if (prevPit !== undefined) process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN = prevPit;
  else delete process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN;
  if (prevJson !== undefined) process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON = prevJson;
});
