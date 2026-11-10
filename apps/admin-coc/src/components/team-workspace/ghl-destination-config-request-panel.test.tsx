import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import type { GhlConfigHead, GhlConfigSubmitBody, GhlLocationPreview } from "@/lib/team-workspace/ghl-destination-config-request";
import type { GuidedGhlLocationChoice } from "@/lib/team-workspace/ghl-destination";

const saves: Array<GhlConfigSubmitBody & { clientAccountId: string }> = [];
const previews: string[] = [];
const storedPreviews = new Map<string, GhlLocationPreview>();
let loadHead: GhlConfigHead = emptyHead();
let saveResult: "stored" | "throw" | "conflict" = "stored";
let loadMode: "ready" | "disabled" = "ready";

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "@/app/actions/team-workspace-ghl-destination") {
    return {
      loadTeamWorkspaceGhlConfigurationAction: async () => {
        if (loadMode === "disabled") {
          return {
            ok: false,
            uncertain: false,
            code: "FEATURE_DISABLED",
            message: "GoHighLevel configuration requests are turned off. Nothing was stored, and delivery was not turned on.",
            head: null,
          };
        }
        return { ok: true, uncertain: false, code: null, message: null, head: loadHead };
      },
      previewTeamWorkspaceGhlLocationAction: async (_client: string, locationId: string) => {
        previews.push(locationId);
        return { ok: true, uncertain: false, code: null, message: null, preview: copyPreview(locationId) };
      },
      saveTeamWorkspaceGhlConfigurationRequestAction: async (input: GhlConfigSubmitBody & { clientAccountId: string }) => {
        saves.push(input);
        if (saveResult === "throw") throw new Error("socket hang up");
        if (saveResult === "conflict") {
          return {
            ok: false,
            uncertain: false,
            stored: false,
            retainRequestId: false,
            needsReload: true,
            code: "revision_conflict",
            message: "The configuration request chain changed. Reload the stored request before submitting again. Nothing was stored.",
            revision: null,
            requestId: input.requestId,
            replayed: false,
            sent: input,
          };
        }
        loadHead = {
          ...loadHead,
          revision: loadHead.revision + 1,
          configuration: {
            requestId: input.requestId,
            revision: loadHead.revision + 1,
            locationId: input.locationId,
            workflowId: input.workflowId,
            fieldMappings: input.fieldMappings,
            snapshotFetchedAt: freshAt(),
            createdAt: freshAt(),
          },
        };
        return {
          ok: true,
          uncertain: false,
          stored: true,
          retainRequestId: false,
          needsReload: false,
          code: null,
          message: "The configuration request was stored. The operational destination was not changed.",
          revision: loadHead.revision,
          requestId: input.requestId,
          replayed: false,
          sent: input,
        };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let Panel: typeof import("./ghl-destination-config-request-panel.tsx").GhlDestinationConfigRequestPanel;

test.before(async () => {
  ({ GhlDestinationConfigRequestPanel: Panel } = await import("./ghl-destination-config-request-panel.tsx"));
});

test.afterEach(() => {
  cleanup();
  saves.length = 0;
  previews.length = 0;
  loadHead = emptyHead();
  saveResult = "stored";
  loadMode = "ready";
  storedPreviews.clear();
});

test("the request panel does not call operational writers", () => {
  const files = [
    new URL("./ghl-destination-config-request-panel.tsx", import.meta.url),
    new URL("../../app/actions/team-workspace-ghl-destination.ts", import.meta.url),
  ];
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.equal(source.includes("postAdminClientGhlConfig"), false);
  assert.equal(source.includes("patchAdminGhlConnectionLinkClient"), false);
  assert.equal(source.includes("activate-ongoing"), false);
  assert.equal(source.includes("test-delivery"), false);
  assert.equal(source.includes("link-client"), false);
  assert.equal(source.includes("postAdminRoutingRuleGhlConfig"), false);
  assert.equal(source.includes("source-funnels"), false);
  assert.equal(source.includes("company-sheets"), false);
  assert.equal(/\bvet\b/i.test(readFileSync(new URL("./ghl-destination-config-request-panel.tsx", import.meta.url), "utf8")), false);
});

test("an operator can select another location, map explicit ids, and store a request", async () => {
  renderPanel();
  assert.equal((await screen.findByText("Request-chain revision")).parentElement?.textContent?.includes("2"), true);
  fireEvent.click(screen.getByRole("button", { name: /Other location/ }));
  assert.equal(saves.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Load snapshot" }));
  assert.equal(await screen.findByText(/not selected until you choose its id/i), screen.getByText(/not selected until you choose its id/i));
  const workflow = screen.getByLabelText("Workflow id") as HTMLSelectElement;
  assert.equal(workflow.value, "");
  assert.equal(workflow.textContent?.includes("wf_a"), false);
  fireEvent.change(workflow, { target: { value: "wf_exact" } });
  choose("Desired coverage", "field_coverage");
  choose("Branch of service", "field_branch");
  choose("Primary reason", "field_reason");
  assert.match(screen.getByLabelText("Configuration request summary").textContent ?? "", /field_coverage/);
  assert.match(screen.getByLabelText("Configuration request summary").textContent ?? "", /field_branch/);
  assert.match(screen.getByLabelText("Configuration request summary").textContent ?? "", /field_reason/);
  fireEvent.click(screen.getByRole("button", { name: "Save configuration request" }));
  assert.equal(await screen.findByText(/configuration request was stored/i), screen.getByText(/configuration request was stored/i));
  assert.equal(saves.length, 1);
  assert.equal(saves[0]?.locationId, "loc_other");
  assert.equal(saves[0]?.workflowId, "wf_exact");
  assert.equal(saves[0]?.expectedRevision, 2);
  assert.equal(saves[0]?.expectedDestinationUpdatedAt, "2026-11-10T12:00:00.000Z");
  assert.deepEqual(saves[0]?.fieldMappings, [
    { key: "branch_of_service", fieldId: "field_branch" },
    { key: "desired_coverage", fieldId: "field_coverage" },
    { key: "primary_reason", fieldId: "field_reason" },
  ]);
  assert.equal(screen.getByText("Location selected").parentElement?.getAttribute("data-state"), "complete");
  assert.equal(screen.getByText("Workflow selected").parentElement?.getAttribute("data-state"), "complete");
  assert.equal(screen.getByText("Fields mapped").parentElement?.getAttribute("data-state"), "complete");
  assert.equal(screen.getByText("Configuration request saved").parentElement?.getAttribute("data-state"), "complete");
  assert.equal(screen.getByText("Awaiting operational application").parentElement?.getAttribute("data-state"), "current");
  assert.match(screen.getByText(/not an active or verified operational destination/i).textContent ?? "", /Not active/);
  assert.equal(screen.queryByRole("button", { name: /activate|enroll|link client/i }), null);
});

test("replacing a stored request requires confirmation", async () => {
  loadHead = emptyHead({
    configuration: {
      requestId: "11111111-1111-4111-8111-111111111111",
      revision: 2,
      locationId: "loc_other",
      workflowId: "wf_exact",
      fieldMappings: [
        { key: "branch_of_service", fieldId: "field_branch" },
        { key: "desired_coverage", fieldId: "field_coverage" },
        { key: "primary_reason", fieldId: "field_reason" },
      ],
      snapshotFetchedAt: freshAt(),
      createdAt: freshAt(),
    },
  });
  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: "Load snapshot" }));
  await screen.findByText(/Snapshot for this location was read/i);
  const save = screen.getByRole("button", { name: "Save configuration request" });
  assert.equal(save.hasAttribute("disabled"), true);
  fireEvent.click(save);
  assert.equal(saves.length, 0);
  fireEvent.click(screen.getByRole("checkbox", { name: /replace the stored configuration request/i }));
  fireEvent.click(screen.getByRole("button", { name: "Save configuration request" }));
  assert.equal(await screen.findByText(/configuration request was stored/i), screen.getByText(/configuration request was stored/i));
  assert.equal(saves.length, 1);
  assert.notEqual(saves[0]?.requestId, "11111111-1111-4111-8111-111111111111");
});

test("an uncertain save retries the same payload and does not start another request", async () => {
  saveResult = "throw";
  renderPanel();
  await fillReady();
  fireEvent.click(screen.getByRole("button", { name: "Save configuration request" }));
  assert.equal(await screen.findByText(/same request id and the same payload/i), screen.getByText(/same request id and the same payload/i));
  fireEvent.change(screen.getByLabelText("Workflow id"), { target: { value: "wf_web" } });
  assert.equal((screen.getByLabelText("Workflow id") as HTMLSelectElement).value, "wf_exact");
  fireEvent.click(screen.getByRole("button", { name: "Save configuration request" }));
  assert.equal(saves.length, 1);
  saveResult = "stored";
  fireEvent.click(screen.getByRole("button", { name: "Retry the same configuration request" }));
  assert.equal(await screen.findByText(/configuration request was stored/i), screen.getByText(/configuration request was stored/i));
  assert.equal(saves.length, 2);
  assert.equal(saves[0]?.requestId, saves[1]?.requestId);
  assert.equal(saves[0]?.workflowId, "wf_exact");
  assert.deepEqual(saves[0]?.fieldMappings, saves[1]?.fieldMappings);
  assert.equal(saves[0]?.expectedRevision, saves[1]?.expectedRevision);
});

test("a stale request chain must be reloaded before another submission", async () => {
  saveResult = "conflict";
  renderPanel();
  await fillReady();
  fireEvent.click(screen.getByRole("button", { name: "Save configuration request" }));
  assert.equal(await screen.findByText(/request chain changed/i), screen.getByText(/request chain changed/i));
  assert.equal(screen.getByRole("button", { name: "Save configuration request" }).hasAttribute("disabled"), true);
  loadHead = { ...loadHead, revision: 5 };
  fireEvent.click(screen.getByRole("button", { name: "Reload the configuration request" }));
  assert.equal(await screen.findByText(/unsaved choices were kept/i), screen.getByText(/unsaved choices were kept/i));
  saveResult = "stored";
  fireEvent.click(screen.getByRole("button", { name: "Save configuration request" }));
  assert.equal(await screen.findByText(/configuration request was stored/i), screen.getByText(/configuration request was stored/i));
  assert.equal(saves.length, 2);
  assert.notEqual(saves[1]?.requestId, saves[0]?.requestId);
  assert.equal(saves[1]?.expectedRevision, 5);
  assert.equal(saves[1]?.workflowId, saves[0]?.workflowId);
});

test("a snapshot from another location is not shown for the selected location", async () => {
  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: /Saved location/ }));
  fireEvent.click(screen.getByRole("button", { name: "Load snapshot" }));
  assert.equal(await screen.findByRole("option", { name: /wf_a/ }), screen.getByRole("option", { name: /wf_a/ }));
  fireEvent.click(screen.getByRole("button", { name: /Other location/ }));
  assert.equal(screen.getByLabelText("GoHighLevel configuration request").querySelector("[data-preview-location]")?.getAttribute("data-preview-location"), "");
  assert.equal((screen.getByLabelText("Workflow id") as HTMLSelectElement).textContent?.includes("wf_a"), false);
  assert.equal(saves.length, 0);
});

test("expired snapshots, duplicate ids, and unresolved ids stay blocked", async () => {
  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: /Other location/ }));
  fireEvent.click(screen.getByRole("button", { name: "Load snapshot" }));
  await screen.findByLabelText("Workflow id");
  storedPreviews.get("loc_other")!.fetchedAt = "2020-01-01T00:00:00.000Z";
  fireEvent.click(screen.getByRole("button", { name: "Refresh snapshot" }));
  assert.equal((await screen.findAllByText(/older than 24 hours/i)).length > 0, true);
  assert.equal(screen.getByRole("button", { name: "Save configuration request" }).hasAttribute("disabled"), true);

  storedPreviews.get("loc_other")!.fetchedAt = freshAt();
  fireEvent.click(screen.getByRole("button", { name: "Refresh snapshot" }));
  await screen.findByText(/Snapshot for this location was read/i);
  fireEvent.change(screen.getByLabelText("Workflow id"), { target: { value: "wf_exact" } });
  choose("Desired coverage", "field_coverage");
  choose("Branch of service", "field_coverage");
  choose("Primary reason", "field_reason");
  assert.equal(screen.getAllByText(/used by more than one mapping/i).length >= 2, true);
  assert.equal(screen.getByRole("button", { name: "Save configuration request" }).hasAttribute("disabled"), true);

  assert.equal(saves.length, 0);
  cleanup();
  loadHead = emptyHead({
    configuration: {
      requestId: "11111111-1111-4111-8111-111111111111",
      revision: 2,
      locationId: "loc_other",
      workflowId: "wf_exact",
      fieldMappings: [
        { key: "desired_coverage", fieldId: "contact.desired_coverage" },
        { key: "branch_of_service", fieldId: "field_branch" },
        { key: "primary_reason", fieldId: "field_reason" },
      ],
      snapshotFetchedAt: freshAt(),
      createdAt: freshAt(),
    },
  });
  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: "Load snapshot" }));
  assert.match((await screen.findAllByText(/matches a field key/i))[0]?.textContent ?? "", /not replaced/i);
  assert.equal((screen.getByLabelText("Desired coverage") as HTMLSelectElement).value, "contact.desired_coverage");
  assert.equal(screen.getByRole("button", { name: "Save configuration request" }).hasAttribute("disabled"), true);
  assert.equal(saves.length, 0);
});

test("a live destination and missing credentials do not submit", async () => {
  loadHead = emptyHead({ liveDestination: true });
  render(<Panel clientAccountId="phase2j_demo" locations={locations()} locationsState="ready" operational={operational({ live: true, active: true })} />);
  assert.match((await screen.findAllByText(/live operational destination already exists/i))[0]?.textContent ?? "", /will not store/i);
  assert.equal(screen.getByRole("button", { name: "Save configuration request" }).hasAttribute("disabled"), true);
  assert.match(screen.getByText(/not an active or verified operational destination/i).textContent ?? "", /Active/);
  cleanup();

  render(<Panel clientAccountId="phase2j_demo" locations={[]} locationsState="ready" operational={operational()} />);
  assert.match((await screen.findByText(/no connected gohighlevel location/i)).textContent ?? "", /does not link a client/i);
  assert.equal(screen.queryByRole("button", { name: /link/i }), null);
  assert.equal(saves.length, 0);
});

test("a disabled flag explains that the request was not stored", async () => {
  loadMode = "disabled";
  renderPanel();
  assert.match((await screen.findByText(/turned off/i)).textContent ?? "", /nothing was stored/i);
  assert.equal(screen.queryByRole("button", { name: "Save configuration request" }), null);
  assert.equal(saves.length, 0);
});

async function fillReady() {
  fireEvent.click(await screen.findByRole("button", { name: /Other location/ }));
  fireEvent.click(screen.getByRole("button", { name: "Load snapshot" }));
  await screen.findByText(/not selected until you choose its id/i);
  fireEvent.change(screen.getByLabelText("Workflow id"), { target: { value: "wf_exact" } });
  choose("Desired coverage", "field_coverage");
  choose("Branch of service", "field_branch");
  choose("Primary reason", "field_reason");
}

function choose(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function renderPanel() {
  render(<Panel clientAccountId="phase2j_demo" locations={locations()} locationsState="ready" operational={operational()} />);
}

function emptyHead(overrides: Partial<GhlConfigHead> = {}): GhlConfigHead {
  return {
    clientAccountId: "phase2j_demo",
    revision: 2,
    destinationUpdatedAt: "2026-11-10T12:00:00.000Z",
    liveDestination: false,
    configuration: null,
    ...overrides,
  };
}

function operational(overrides: Partial<{ live: boolean; active: boolean }> = {}) {
  return {
    configured: true,
    verified: false,
    active: overrides.active === true,
    live: overrides.live === true,
    locationId: "loc_saved",
    updatedAt: "2026-11-10T12:00:00.000Z",
  };
}

function locations(): GuidedGhlLocationChoice[] {
  return [
    { connectionId: "c1", locationId: "loc_saved", locationName: "Saved location", connectionStatus: "connected", lastError: null, saved: true },
    { connectionId: "c2", locationId: "loc_other", locationName: "Other location", connectionStatus: "connected", lastError: null, saved: false },
    { connectionId: "c3", locationId: "loc_down", locationName: "Disconnected", connectionStatus: "error", lastError: "HTTP 401", saved: false },
  ];
}

function copyPreview(locationId: string): GhlLocationPreview {
  const stored = storedPreview(locationId);
  return {
    ...stored,
    workflows: stored.workflows.map((workflow) => ({ ...workflow })),
    fields: stored.fields.map((field) => ({ ...field })),
    errors: [...stored.errors],
  };
}

function storedPreview(locationId: string): GhlLocationPreview {
  const existing = storedPreviews.get(locationId);
  if (existing) return existing;
  const preview: GhlLocationPreview = {
    locationId,
    fetchedAt: freshAt(),
    fromCache: false,
    workflows: locationId === "loc_saved"
      ? [{ id: "wf_a", name: "Saved workflow" }]
      : [{ id: "wf_web", name: "Intake Webform" }, { id: "wf_exact", name: "Exact workflow" }],
    fields: [
      { id: "field_coverage", name: "Desired Coverage", key: null, fieldKey: "contact.desired_coverage" },
      { id: "field_branch", name: "Branch of Service", key: null, fieldKey: "contact.branch_of_service" },
      { id: "field_reason", name: "Primary Reason", key: null, fieldKey: "contact.primary_reason" },
    ],
    errors: [],
  };
  storedPreviews.set(locationId, preview);
  return preview;
}

function freshAt(): string {
  return new Date().toISOString();
}
