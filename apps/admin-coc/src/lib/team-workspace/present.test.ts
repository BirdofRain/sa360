import assert from "node:assert/strict";
import test from "node:test";

import { parseTeamWorkspaceResponse, readAdminErrorCode } from "./parse.ts";
import {
  assembleTeamWorkspaceDetail,
  presentTeamWorkspace,
  projectClientOptions,
  projectRoutingRules,
  type AssembleInput,
} from "./present.ts";
import type { TeamWorkspaceRead, TeamWorkspaceStepStatus } from "./types.ts";

function workspace(overrides: Partial<TeamWorkspaceRead> = {}): TeamWorkspaceRead {
  return {
    ok: true,
    contractVersion: "team_workspace_delivery_v1",
    client: {
      clientAccountId: "alex_gross",
      clientDisplayName: "Alex Gross",
      status: "onboarding",
    },
    setupRequest: {
      present: false,
      status: null,
      revision: 0,
      destinationChoice: "undecided",
      operational: false,
    },
    destinations: {
      ghl: { configured: false, deliveryEnabled: false, deliveryMode: null, locationIdPresent: false },
      companySheets: {
        configured: false,
        campaignDispatchEnabled: false,
        campaignDispatchNotBefore: null,
        agedDispatchEnabled: false,
      },
      customWebhook: { present: false, enabled: false, endpointHost: null },
    },
    recentCanonicalDeliveries: [],
    clientNotification: {
      enabled: false,
      canEnable: false,
      blockedReason: "recipient_not_verified",
      recipientVerified: false,
      revision: 0,
    },
    notifications: { items: [] },
    ...overrides,
  };
}

function input(overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    clientAccountId: "alex_gross",
    clients: [{ clientAccountId: "alex_gross", clientDisplayName: "Alex Gross", status: "onboarding" }],
    workspace: { availability: "ready", body: workspace() },
    account: { loaded: true, clientDisplayName: "Alex Gross", status: "onboarding", rules: [] },
    onboarding: { availability: "ready", linkedSources: 0, blockers: [] },
    ...overrides,
  };
}

function statuses(model: ReturnType<typeof assembleTeamWorkspaceDetail>): Record<string, TeamWorkspaceStepStatus> {
  assert.equal(model.kind, "ready");
  if (model.kind !== "ready") throw new Error("expected a view");
  return Object.fromEntries(model.view.steps.map((step) => [step.id, step.status]));
}

test("an empty client stays pending and does not look activated", () => {
  const model = assembleTeamWorkspaceDetail(input());
  assert.deepEqual(statuses(model), {
    client_information: "complete",
    lead_source: "pending",
    delivery_destination: "pending",
    delivery_notifications: "unavailable",
    setup_verification: "pending",
    completion: "pending",
  });
  if (model.kind !== "ready") return;
  assert.match(model.view.setupLine, /not an operational switch/i);
  assert.equal(model.view.steps.find((step) => step.status === "complete" && step.id === "completion"), undefined);
  assert.match(model.view.steps.find((step) => step.id === "setup_verification")?.summary ?? "", /does not confirm a live delivery/i);
  const notification = model.view.steps.find((step) => step.id === "delivery_notifications");
  assert.match(notification?.summary ?? "", /is off/);
  assert.equal(/server notification flag|SA360_DELIVERY_SUCCESS_NOTIFY/i.test(JSON.stringify(notification)), false);
});

test("a partial client with a saved GoHighLevel row is not treated as live", () => {
  const body = workspace({
    setupRequest: {
      present: true,
      status: "submitted",
      revision: 2,
      destinationChoice: "ghl",
      operational: false,
    },
    destinations: {
      ghl: { configured: true, deliveryEnabled: false, deliveryMode: "shadow", locationIdPresent: true },
      companySheets: {
        configured: false,
        campaignDispatchEnabled: false,
        campaignDispatchNotBefore: null,
        agedDispatchEnabled: false,
      },
      customWebhook: { present: false, enabled: false, endpointHost: null },
    },
  });
  const model = assembleTeamWorkspaceDetail(
    input({
      workspace: { availability: "ready", body },
      account: {
        loaded: true,
        clientDisplayName: "Alex Gross",
        status: "onboarding",
        rules: [{ label: "Veteran campaign", active: true }],
      },
    })
  );
  assert.equal(statuses(model).lead_source, "complete");
  assert.equal(statuses(model).delivery_destination, "complete");
  assert.equal(statuses(model).completion, "pending");
  if (model.kind !== "ready") return;
  const destination = model.view.steps.find((step) => step.id === "delivery_destination");
  assert.match(destination?.details.join(" ") ?? "", /Live delivery: off/);
});

test("a requested destination that is not saved is blocked", () => {
  const body = workspace({
    setupRequest: {
      present: true,
      status: "draft",
      revision: 1,
      destinationChoice: "both",
      operational: false,
    },
    destinations: {
      ghl: { configured: true, deliveryEnabled: false, deliveryMode: "shadow", locationIdPresent: true },
      companySheets: {
        configured: false,
        campaignDispatchEnabled: false,
        campaignDispatchNotBefore: null,
        agedDispatchEnabled: false,
      },
      customWebhook: { present: false, enabled: false, endpointHost: null },
    },
  });
  const found = statuses(assembleTeamWorkspaceDetail(input({
    workspace: { availability: "ready", body },
  })));
  assert.equal(found.delivery_destination, "blocked");
  assert.equal(found.completion, "blocked");
});

test("needs information without a source is blocked, and onboarding blockers stay blocked", () => {
  const body = workspace({
    setupRequest: {
      present: true,
      status: "needs_information",
      revision: 3,
      destinationChoice: "undecided",
      operational: false,
    },
  });
  const needsInfo = statuses(
    assembleTeamWorkspaceDetail(input({ workspace: { availability: "ready", body } }))
  );
  assert.equal(needsInfo.lead_source, "blocked");
  assert.equal(needsInfo.setup_verification, "blocked");

  const blocked = statuses(
    assembleTeamWorkspaceDetail(
      input({ onboarding: { availability: "ready", linkedSources: 0, blockers: ["sheets_destination_saved"] } })
    )
  );
  assert.equal(blocked.setup_verification, "blocked");
  assert.notEqual(blocked.completion, "complete");
});

test("onboarding and workspace reads that are off stay unavailable", () => {
  const off = statuses(
    assembleTeamWorkspaceDetail(
      input({
        workspace: { availability: "disabled" },
        onboarding: { availability: "unavailable" },
      })
    )
  );
  assert.equal(off.client_information, "complete");
  assert.equal(off.delivery_destination, "unavailable");
  assert.equal(off.delivery_notifications, "unavailable");
  assert.equal(off.setup_verification, "unavailable");
  assert.equal(off.completion, "unavailable");

  const failed = assembleTeamWorkspaceDetail(
    input({
      workspace: { availability: "error", code: "request_failed" },
      account: { loaded: false },
      onboarding: { availability: "error" },
    })
  );
  assert.equal(failed.kind, "error");
});

test("a missing client and a forbidden read do not render another client's setup", () => {
  assert.equal(assembleTeamWorkspaceDetail(input({ workspace: { availability: "not_found" } })).kind, "not_found");
  assert.equal(
    assembleTeamWorkspaceDetail(input({ workspace: { availability: "forbidden" }, account: { loaded: true, clientDisplayName: "Alex Gross", status: "active", rules: [] } })).kind,
    "forbidden"
  );
});

test("listed receipt ids are kept for support and do not complete activation", () => {
  const body = workspace({
    recentCanonicalDeliveries: [
      {
        channel: "company_sheets",
        receiptId: "job_1",
        sourceLeadEventId: "lead_1",
        canonical: true,
        at: "2026-11-06T15:00:00.000Z",
      },
    ],
  });
  const model = assembleTeamWorkspaceDetail(input({ workspace: { availability: "ready", body } }));
  assert.equal(model.kind, "ready");
  if (model.kind !== "ready") return;
  assert.equal(model.view.receipts.sheetsJobId, "job_1");
  assert.equal(model.view.receipts.sourceLeadEventId, "lead_1");
  assert.equal(model.view.receipts.ghlLiveRunId, null);
  assert.equal(model.view.steps.find((step) => step.id === "completion")?.status, "pending");
});

test("the parser drops secrets, full webhook URLs, and a false operational flag", () => {
  const parsed = parseTeamWorkspaceResponse({
    ...workspace(),
    clientPhone: "+15551212",
    endpointUrl: "https://hooks.example.test/secret",
    signingSecret: "super-secret",
  });
  assert.ok(parsed);
  assert.equal(JSON.stringify(parsed).includes("+15551212"), false);
  assert.equal(JSON.stringify(parsed).includes("super-secret"), false);
  assert.equal(JSON.stringify(parsed).includes("https://hooks.example.test/secret"), false);

  const leakedHost = parseTeamWorkspaceResponse({
    ...workspace(),
    destinations: {
      ...workspace().destinations,
      customWebhook: { present: true, enabled: false, endpointHost: "https://hooks.example.test/secret" },
    },
  });
  assert.equal(leakedHost, null);

  const operational = parseTeamWorkspaceResponse({
    ...workspace(),
    setupRequest: { ...workspace().setupRequest, operational: true },
  });
  assert.equal(operational, null);

  const killSwitch = parseTeamWorkspaceResponse({
    ...workspace(),
    notifications: { enabled: true, items: [] },
  });
  assert.equal(killSwitch?.clientNotification.enabled, false);
  assert.equal(JSON.stringify(killSwitch).includes('"enabled":true'), false);

  const missingPreference = parseTeamWorkspaceResponse({
    ...workspace(),
    clientNotification: undefined,
    notifications: { enabled: true, items: [] },
  });
  assert.equal(missingPreference, null);

  const missingRevision = parseTeamWorkspaceResponse({
    ...workspace(),
    clientNotification: {
      enabled: false,
      canEnable: false,
      blockedReason: "recipient_not_verified",
      recipientVerified: false,
    },
  });
  assert.equal(missingRevision, null);

  const leakedMailbox = parseTeamWorkspaceResponse({
    ...workspace(),
    clientNotification: {
      ...workspace().clientNotification,
      recipientEmail: "owner@example.test",
    },
  });
  assert.ok(leakedMailbox);
  assert.equal(JSON.stringify(leakedMailbox).includes("owner@example.test"), false);
  assert.equal(JSON.stringify(leakedMailbox).includes("recipientEmail"), false);
  assert.equal(readAdminErrorCode(404, JSON.stringify({ error: "team_workspace_disabled" })), "team_workspace_disabled");
  assert.equal(readAdminErrorCode(500, "<html>token</html>"), "request_failed");
});

test("client and campaign projections omit urls, emails, and destination ids", () => {
  assert.deepEqual(
    projectClientOptions([
      { clientAccountId: "alex_gross", clientDisplayName: "Alex Gross", status: "onboarding" },
      { clientAccountId: "bad id", clientDisplayName: "Nope", status: "active" },
    ]),
    [{ clientAccountId: "alex_gross", clientDisplayName: "Alex Gross", status: "onboarding" }]
  );
  assert.deepEqual(
    projectRoutingRules([
      {
        campaignName: "https://sheets.example/secret",
        utmCampaign: "person@example.test",
        matchType: "campaign_id",
        active: true,
      },
    ]),
    [{ label: "campaign_id", active: true }]
  );
});

test("a verified preference is shown without becoming activation", () => {
  const savedOn = assembleTeamWorkspaceDetail(
    input({
      workspace: {
        availability: "ready",
        body: workspace({
          clientNotification: {
            enabled: true,
            canEnable: true,
            blockedReason: null,
            recipientVerified: true,
            revision: 2,
          },
        }),
      },
    })
  );
  assert.equal(savedOn.kind, "ready");
  if (savedOn.kind !== "ready") return;
  const onStep = savedOn.view.steps.find((step) => step.id === "delivery_notifications");
  assert.equal(onStep?.status, "pending");
  assert.match(onStep?.summary ?? "", /is on/);
  assert.equal(savedOn.view.notification.enabled, true);
  assert.equal(savedOn.view.notification.revision, 2);
  assert.equal(savedOn.view.notification.readable, true);
  assert.equal(JSON.stringify(savedOn.view).includes("@"), false);
  assert.equal(savedOn.view.steps.find((step) => step.id === "completion")?.status === "complete", false);

  const savedOff = assembleTeamWorkspaceDetail(
    input({
      workspace: {
        availability: "ready",
        body: workspace({
          clientNotification: {
            enabled: false,
            canEnable: true,
            blockedReason: null,
            recipientVerified: true,
            revision: 3,
          },
        }),
      },
    })
  );
  assert.equal(savedOff.kind, "ready");
  if (savedOff.kind !== "ready") return;
  assert.equal(savedOff.view.notification.enabled, false);
  assert.equal(savedOff.view.notification.canEnable, true);
  assert.equal(savedOff.view.notification.revision, 3);
  assert.equal(
    savedOff.view.steps.find((step) => step.id === "delivery_notifications")?.status,
    "pending"
  );
});

test("presentTeamWorkspace never marks notification or completion complete", () => {
  const view = presentTeamWorkspace(input(), { name: "Alex Gross", status: "active" });
  for (const id of ["delivery_notifications", "setup_verification", "completion"] as const) {
    assert.notEqual(view.steps.find((step) => step.id === id)?.status, "complete", id);
  }
});
