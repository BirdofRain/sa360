import assert from "node:assert/strict";
import test from "node:test";

import { buildTeamWorkspaceTicketContext } from "./ticket-context.ts";

test("ticket context keeps the contract ids and the onboarding step", () => {
  const ticket = buildTeamWorkspaceTicketContext({
    clientAccountId: "alex_gross",
    stepId: "delivery_destination",
    receipts: {
      sourceLeadEventId: "lead_1",
      sheetsJobId: "job_1",
      ghlLiveRunId: "run_1",
      customWebhookAttemptId: null,
    },
  });
  assert.equal(ticket.category, "DELIVERY");
  assert.equal(ticket.contextOverride.clientAccountId, "alex_gross");
  assert.equal(ticket.contextOverride.relatedEntityType, "company_sheets_delivery_job");
  assert.equal(ticket.contextOverride.relatedEntityId, "job_1");
  assert.deepEqual(ticket.contextOverride.contextJson, {
    teamWorkspace: {
      contractVersion: "team_workspace_delivery_v1",
      clientAccountId: "alex_gross",
      step: "delivery_destination",
      sourceLeadEventId: "lead_1",
      sheetsJobId: "job_1",
      ghlLiveRunId: "run_1",
      customWebhookAttemptId: null,
    },
  });
});

test("a webhook attempt id selects the webhook category and entity", () => {
  const ticket = buildTeamWorkspaceTicketContext({
    clientAccountId: "alex_gross",
    stepId: "delivery_notifications",
    receipts: {
      sourceLeadEventId: null,
      sheetsJobId: null,
      ghlLiveRunId: null,
      customWebhookAttemptId: "attempt_1",
    },
  });
  assert.equal(ticket.category, "WEBHOOK");
  assert.equal(ticket.contextOverride.relatedEntityType, "custom_webhook_attempt");
  assert.equal(ticket.contextOverride.relatedEntityId, "attempt_1");
});

test("ticket context drops secrets, urls, phones, and unsafe ids", () => {
  const ticket = buildTeamWorkspaceTicketContext({
    clientAccountId: "alex_gross",
    stepId: "client_information",
    receipts: {
      sourceLeadEventId: "person@example.test",
      sheetsJobId: "https://hooks.example.test/lead?token=secret",
      ghlLiveRunId: "run_1",
      customWebhookAttemptId: "not an id",
    },
  });
  const serialized = JSON.stringify(ticket);
  assert.equal(serialized.includes("endpointUrl"), false);
  assert.equal(serialized.includes("signingSecret"), false);
  assert.equal(serialized.includes("person@example.test"), false);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("token"), false);
  assert.equal(ticket.contextOverride.relatedEntityType, "ghl_live_delivery_run");
  assert.equal(ticket.contextOverride.relatedEntityId, "run_1");
  assert.equal(ticket.contextOverride.contextJson?.teamWorkspace && (ticket.contextOverride.contextJson.teamWorkspace as { sheetsJobId: string | null }).sheetsJobId, null);
});

test("the index has no client id until one is selected", () => {
  const ticket = buildTeamWorkspaceTicketContext({});
  assert.equal(ticket.contextOverride.clientAccountId, undefined);
  assert.equal(ticket.contextOverride.relatedEntityType, undefined);
  assert.equal(ticket.category, "DELIVERY");
  const workspace = (ticket.contextOverride.contextJson?.teamWorkspace ?? {}) as { clientAccountId: string | null; step: string | null };
  assert.equal(workspace.clientAccountId, null);
  assert.equal(workspace.step, null);
});
