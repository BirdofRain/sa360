import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import type { GuidedGhlActionResult } from "@/app/actions/team-workspace-ghl-destination";
import { presentGuidedGhlDestination } from "@/lib/team-workspace/ghl-destination.ts";

const calls: string[] = [];
let loadResult: GuidedGhlActionResult = { ok: false, code: "READ_FAILED", message: "The destination could not be read.", view: null };
let snapshotResult: GuidedGhlActionResult = loadResult;

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "@/app/actions/team-workspace-ghl-destination") {
    return {
      loadTeamWorkspaceGhlDestinationAction: async () => {
        calls.push("load");
        return loadResult;
      },
      readTeamWorkspaceGhlSnapshotAction: async (_client: string, locationId: string, refresh: boolean) => {
        calls.push(`snapshot:${locationId}:${refresh}`);
        return snapshotResult;
      },
      checkTeamWorkspaceGhlConnectionAction: async () => {
        calls.push("probe");
        return loadResult;
      },
      saveTeamWorkspaceGhlDestinationAction: async () => {
        calls.push("save");
        return { ok: false, code: "WRITE_BLOCKED", message: "blocked", view: null };
      },
      loadTeamWorkspaceGhlConfigurationAction: async () => ({
        ok: false,
        uncertain: false,
        code: "FEATURE_DISABLED",
        message: "GoHighLevel configuration requests are turned off. Nothing was stored, and delivery was not turned on.",
        head: null,
      }),
      previewTeamWorkspaceGhlLocationAction: async () => ({
        ok: false,
        uncertain: false,
        code: "FEATURE_DISABLED",
        message: "GoHighLevel configuration requests are turned off. Nothing was stored, and delivery was not turned on.",
        preview: null,
      }),
      saveTeamWorkspaceGhlConfigurationRequestAction: async () => {
        calls.push("config-save");
        return {
          ok: false,
          uncertain: false,
          stored: false,
          retainRequestId: false,
          needsReload: false,
          code: "FEATURE_DISABLED",
          message: "GoHighLevel configuration requests are turned off.",
          revision: null,
          requestId: null,
          replayed: false,
          sent: null,
        };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let Guide: typeof import("./ghl-destination-guide.tsx").GhlDestinationGuide;

test.before(async () => {
  ({ GhlDestinationGuide: Guide } = await import("./ghl-destination-guide.tsx"));
});

test.afterEach(() => {
  cleanup();
  calls.length = 0;
});

test("the guide does not expose delivery, enrollment, or a destination save", () => {
  const source = readFileSync(new URL("./ghl-destination-guide.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("saveTeamWorkspaceGhlDestinationAction"), false);
  assert.equal(source.includes("activate-ongoing"), false);
  assert.equal(source.includes("test-delivery"), false);
  assert.equal(source.includes("ghl-config"), false);
  assert.equal(source.includes("link-client"), false);
  assert.equal(/\bvet\b/i.test(source), false);
});

test("a read failure can be retried and does not report a saved change", async () => {
  loadResult = {
    ok: false,
    code: "UNCERTAIN",
    message: "Admin API request failed: socket hang up",
    view: presentGuidedGhlDestination({
      clientAccountId: "phase2g_demo",
      loadError: "Admin API request failed: socket hang up",
      uncertain: true,
    }),
  };
  render(<Guide clientAccountId="phase2g_demo" />);
  const retry = await screen.findByRole("button", { name: "Retry the last read" });
  assert.match(screen.getByText(/could not be confirmed/i).textContent ?? "", /socket hang up/i);
  loadResult = { ok: true, view: savedView() };
  fireEvent.click(retry);
  assert.equal(await screen.findByText("Configured"), await screen.findByText("Configured"));
  assert.equal(calls.includes("save"), false);
  assert.equal(calls.includes("probe"), false);
});

test("a live destination cannot be probed and a different workflow is not saved", async () => {
  const first = savedView();
  first.active = true;
  first.live = true;
  first.deliveryMode = "live";
  first.deliveryEnabled = true;
  first.clientCutoverApproved = true;
  first.internalApprovalStatus = "approved";
  loadResult = { ok: true, view: first };
  snapshotResult = {
    ok: true,
    view: { ...savedView(), updatedAt: "2026-11-10T13:00:00.000Z", workflows: [
      { id: "wf_saved", name: "Saved webform", saved: true },
      { id: "wf_other", name: "Other workflow", saved: false },
    ], snapshotLoaded: true },
  };
  render(<Guide clientAccountId="phase2g_demo" />);
  assert.equal((await screen.findByRole("button", { name: "Check credentials" })).hasAttribute("disabled"), true);
  fireEvent.click(screen.getByRole("button", { name: "Refresh from GoHighLevel" }));
  assert.equal(await screen.findByText(/saved destination changed/i), screen.getByText(/saved destination changed/i));
  fireEvent.click(screen.getByRole("button", { name: /Other workflow/ }));
  assert.match(screen.getByText(/does not save it/i).textContent ?? "", /not the saved workflow id/i);
  assert.equal(calls.includes("probe"), false);
  assert.equal(calls.includes("save"), false);
  assert.equal(calls.some((call) => call === "snapshot:loc_saved:true"), true);
});

test("unresolved, duplicate, and mismatched workflow issues stay visible", async () => {
  loadResult = {
    ok: true,
    view: presentGuidedGhlDestination({
      clientAccountId: "phase2g_demo",
      destination: {
        destinationSubaccountIdGhl: "loc_saved",
        locationName: "Saved location",
        destinationWorkflowIdGhl: "wf_missing",
        deliveryMode: "shadow",
        deliveryEnabled: false,
        clientCutoverApproved: false,
        internalApprovalStatus: "not_reviewed",
        updatedAt: "2026-11-10T12:00:00.000Z",
        sourceAttributeFieldMapJson: {
          desired_coverage: "contact.desired_coverage",
          branch_of_service: "field_shared",
          primary_reason: "field_shared",
        },
        sa360CustomFieldIdMapJson: {},
      },
      connections: [
        {
          id: "conn_saved",
          locationId: "loc_saved",
          locationName: "Saved location",
          connectionStatus: "error",
          lastError: "HTTP 401",
        },
      ],
      issueCodes: ["probe_required"],
      snapshot: {
        locationId: "loc_saved",
        workflows: [{ id: "wf_saved", name: "Webform workflow" }],
        customFields: [
          { id: "field_coverage", name: "Desired Coverage", fieldKey: "contact.desired_coverage" },
          { id: "field_shared", name: "Shared", fieldKey: "contact.shared" },
        ],
        fetchedAt: "2026-11-10T12:00:00.000Z",
        fromCache: true,
        snapshotVerification: "live",
        errors: [],
      },
      now: new Date("2026-11-10T12:00:00.000Z"),
    }),
  };
  render(<Guide clientAccountId="phase2g_demo" />);
  assert.equal((await screen.findAllByText("Not verified")).length > 0, true);
  assert.equal(screen.getAllByText(/Desired coverage/i).some((node) => /unresolved/i.test(node.textContent ?? "")), true);
  assert.equal(screen.getAllByText(/Branch of service/i).some((node) => /duplicate/i.test(node.textContent ?? "")), true);
  assert.equal(screen.getAllByText(/not in the location snapshot/i).length > 0, true);
  assert.match(screen.getByText(/HTTP 401/).textContent ?? "", /401/);
  assert.equal(screen.queryByRole("button", { name: /save gohighlevel/i }), null);
});

test("Harbor saved ids stay visible when the latest snapshot is not current", async () => {
  loadResult = {
    ok: true,
    view: presentGuidedGhlDestination({
      clientAccountId: "harbor_benefits",
      destination: {
        destinationSubaccountIdGhl: "loc_harbor_local",
        locationName: "Harbor location",
        destinationWorkflowIdGhl: "wf_harbor_saved",
        deliveryMode: "shadow",
        deliveryEnabled: false,
        clientCutoverApproved: false,
        internalApprovalStatus: "not_reviewed",
        updatedAt: "2026-11-11T23:10:37.772Z",
        sourceAttributeFieldMapJson: {},
        sa360CustomFieldIdMapJson: {
          desired_coverage: "harbor_keep_coverage",
          branch_of_service: "harbor_keep_branch",
          primary_reason: "harbor_keep_reason",
        },
      },
      connections: [
        {
          id: "conn_harbor",
          locationId: "loc_harbor_local",
          locationName: "Harbor location",
          connectionStatus: "connected",
        },
      ],
      snapshot: {
        locationId: "loc_harbor_local",
        workflows: [{ id: "wf_harbor_saved", name: "Harbor saved workflow" }],
        customFields: [{ id: "harbor_keep_coverage", name: "Desired Coverage" }],
        snapshotVerification: "previously_captured",
        errors: ["The latest refresh failed: Invalid JWT"],
      },
    }),
  };
  render(<Guide clientAccountId="harbor_benefits" />);
  const coverage = await screen.findAllByText(/Saved id harbor_keep_coverage/);
  assert.equal(coverage.length, 2);
  assert.match(coverage[0]?.textContent ?? "", /not currently verified/i);
  assert.equal(screen.getAllByText(/Saved id harbor_keep_branch/).length, 2);
  assert.equal(screen.getAllByText(/Saved id harbor_keep_reason/).length, 2);
  assert.equal(screen.getAllByText(/not currently verified/i).length >= 3, true);
  assert.equal(screen.queryByText(/No SA360 field ids are saved/i), null);
  assert.equal(screen.queryByRole("button", { name: /save gohighlevel/i }), null);
});

function savedView() {
  return presentGuidedGhlDestination({
    clientAccountId: "phase2g_demo",
    destination: {
      destinationSubaccountIdGhl: "loc_saved",
      locationName: "Saved location",
      destinationWorkflowIdGhl: "wf_saved",
      workflowTriggerMode: "tag_trigger",
      deliveryMode: "shadow",
      deliveryEnabled: false,
      clientCutoverApproved: false,
      internalApprovalStatus: "not_reviewed",
      updatedAt: "2026-11-10T12:00:00.000Z",
      sourceAttributeFieldMapJson: {
        desired_coverage: "field_coverage",
        branch_of_service: "field_branch",
        primary_reason: "field_reason",
      },
      sa360CustomFieldIdMapJson: { sa360_lead_uid: "field_uid" },
    },
    connections: [
      {
        id: "conn_saved",
        locationId: "loc_saved",
        locationName: "Saved location",
        connectionStatus: "connected",
        lastError: null,
      },
    ],
    snapshot: {
      locationId: "loc_saved",
      workflows: [{ id: "wf_saved", name: "Saved webform" }],
      customFields: [
        { id: "field_coverage", name: "Desired Coverage" },
        { id: "field_branch", name: "Branch of Service" },
        { id: "field_reason", name: "Primary Reason" },
        { id: "field_uid", name: "SA360 Lead UID" },
      ],
      fetchedAt: "2026-11-10T12:00:00.000Z",
      fromCache: true,
      errors: [],
    },
  });
}
