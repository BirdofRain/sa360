import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import type { GuidedOnboardingModel } from "@/lib/team-workspace/onboarding-guide";

type SaveInput = { clientAccountId: string; data: Record<string, unknown>; requestId: string; expectedRevision: number };
type UpdateInput = { clientAccountId: string; clientDisplayName: string; status: string; primaryNicheKeys: string[]; primaryProductTypes: string[] };

const saves: SaveInput[] = [];
const updates: UpdateInput[] = [];
const creates: string[] = [];
let saveGate: Promise<void> | null = null;
let saveRejects = false;
let updateRejects = false;
let createRejects = false;
let saveResult: { ok: true; revision: number; replayed: boolean; status: "draft"; data: Record<string, unknown>; missingRequiredFields: string[]; repairRequired: boolean } | { ok: false; code: string | null; error: string } = {
  ok: true,
  revision: 3,
  replayed: false,
  status: "draft",
  data: {},
  missingRequiredFields: [],
  repairRequired: false,
};
const refreshCalls: string[] = [];

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "next/navigation") {
    return { useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => refreshCalls.push("refresh") }) };
  }
  if (request === "@/app/actions/team-workspace-ghl-destination") {
    return {
      loadTeamWorkspaceGhlDestinationAction: async () => ({
        ok: false,
        code: "FEATURE_DISABLED",
        message: "Team Workspace is turned off. The GoHighLevel destination was not read, and delivery was not turned on.",
        view: null,
      }),
      readTeamWorkspaceGhlSnapshotAction: async () => ({ ok: false, code: "FEATURE_DISABLED", message: "off", view: null }),
      checkTeamWorkspaceGhlConnectionAction: async () => ({ ok: false, code: "FEATURE_DISABLED", message: "off", view: null }),
      saveTeamWorkspaceGhlDestinationAction: async () => ({ ok: false, code: "WRITE_BLOCKED", message: "blocked", view: null }),
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
        message: "GoHighLevel configuration requests are turned off.",
        preview: null,
      }),
      saveTeamWorkspaceGhlConfigurationRequestAction: async () => ({
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
      }),
    };
  }
  if (request === "@/app/actions/team-workspace-company-sheets") {
    return {
      loadTeamWorkspaceCompanySheetsAction: async () => ({
        ok: false,
        code: "FEATURE_DISABLED",
        message: "Team Workspace is turned off. Company Sheets was not read, and delivery was not turned on.",
        uncertain: false,
        snapshot: null,
        nextPageToken: null,
      }),
      inspectTeamWorkspaceCompanySheetsStorageAction: async () => ({
        ok: false,
        code: "FEATURE_DISABLED",
        message: "Team Workspace is turned off.",
        uncertain: false,
        snapshot: null,
        nextPageToken: null,
      }),
      readTeamWorkspaceCompanySheetsWorksheetsAction: async () => ({
        ok: false,
        code: "FEATURE_DISABLED",
        message: "Team Workspace is turned off.",
        uncertain: false,
        read: null,
      }),
      pageTeamWorkspaceCompanySheetsSpreadsheetsAction: async () => ({
        ok: false,
        code: "FEATURE_DISABLED",
        message: "Team Workspace is turned off.",
        uncertain: false,
        spreadsheets: [],
        skipped: 0,
        nextPageToken: null,
      }),
    };
  }
  if (request === "@/app/actions/source-campaign-request") {
    return {
      submitSourceCampaignRequestAction: async () => ({
        ok: false,
        uncertain: false,
        stored: false,
        retainRequestId: false,
        code: "FEATURE_DISABLED",
        message: "Formal source and campaign requests are turned off.",
        status: null,
        revision: null,
        requestId: null,
        replayed: false,
        supersededRequestId: null,
        sent: null,
      }),
      rejectSourceCampaignRequestAction: async () => ({
        ok: false,
        uncertain: false,
        stored: false,
        retainRequestId: false,
        code: "FEATURE_DISABLED",
        message: "Formal source and campaign requests are turned off.",
        status: null,
        revision: null,
        requestId: null,
        replayed: false,
        supersededRequestId: null,
        sent: null,
      }),
    };
  }
  if (request === "@/app/actions/team-workspace-onboarding") {
    return {
      createGuidedClientAction: async (input: { clientAccountId: string }) => {
        creates.push(input.clientAccountId);
        if (createRejects) throw new Error("create rejected");
        return { ok: true, clientAccountId: "new_client", clientDisplayName: "New Client" };
      },
      updateGuidedClientAction: async (input: UpdateInput) => {
        updates.push(input);
        if (updateRejects) throw new Error("update rejected");
        return { ok: true, clientAccountId: input.clientAccountId, clientDisplayName: input.clientDisplayName };
      },
      saveGuidedSetupAction: async (input: SaveInput) => {
        saves.push(input);
        if (saveGate) await saveGate;
        if (saveRejects) throw new Error("setup rejected");
        return saveResult.ok ? { ...saveResult, data: input.data, revision: input.expectedRevision + 1 } : saveResult;
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let GuidedOnboarding: typeof import("./guided-onboarding.tsx").GuidedOnboarding;

test.before(async () => {
  ({ GuidedOnboarding } = await import("./guided-onboarding.tsx"));
});

test.afterEach(() => {
  cleanup();
  saves.length = 0;
  updates.length = 0;
  creates.length = 0;
  refreshCalls.length = 0;
  saveGate = null;
  saveRejects = false;
  updateRejects = false;
  createRejects = false;
  saveResult = {
    ok: true,
    revision: 3,
    replayed: false,
    status: "draft",
    data: {},
    missingRequiredFields: [],
    repairRequired: false,
  };
});

function guide(overrides: Partial<GuidedOnboardingModel> = {}): GuidedOnboardingModel {
  return {
    clientAccountId: "alex_gross",
    setupWritable: true,
    setupUnavailableReason: null,
    setupStale: false,
    account: { clientDisplayName: "Alex Gross", status: "onboarding", primaryNicheKeys: ["VET"], primaryProductTypes: [] },
    setup: {
      status: "draft",
      revision: 2,
      repairRequired: false,
      missingRequiredFields: [],
      data: { clientEmail: "alex@example.com" },
    },
    recordedSetup: { present: true, status: "draft", revision: 2, destinationChoice: "undecided" },
    sources: { availability: "ready", items: [] },
    campaigns: { availability: "ready", rules: [] },
    destinations: {
      ghl: { configured: false, deliveryEnabled: false },
      companySheets: { configured: false, campaignDispatchEnabled: false, agedDispatchEnabled: false },
    },
    verification: { availability: "ready", blockers: [] },
    ghlConfigurationRequest: { availability: "unreadable", message: "The GoHighLevel configuration request was not loaded. It is not treated as saved." },
    companySheetsConfigurationRequest: { availability: "unreadable", message: "The Company Sheets configuration request was not loaded. It is not treated as saved." },
    operational: false,
    ...overrides,
  };
}

test("a successful save stores the request and does not activate delivery", async () => {
  render(<GuidedOnboarding model={guide()} step="destination" clients={[]} />);
  fireEvent.click(screen.getByRole("radio", { name: "Both" }));
  fireEvent.click(screen.getByRole("button", { name: "Save destination choice" }));
  await screen.findByText(/destination choice was saved/i);
  assert.equal(saves.length, 1);
  assert.equal(saves[0]?.expectedRevision, 2);
  assert.equal(saves[0]?.data.destinationChoice, "both");
  assert.equal(JSON.stringify(saves[0]?.data).includes("deliveryEnabled"), false);
  assert.equal(JSON.stringify(updates).includes("portalEnabled"), false);
  assert.equal(screen.queryByRole("button", { name: /activate/i }), null);
  assert.equal(refreshCalls.length, 1);
});

test("an invalid email blocks the save", () => {
  render(<GuidedOnboarding model={guide()} step="information" clients={[]} />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
  fireEvent.click(screen.getByRole("button", { name: "Save client information" }));
  assert.equal(screen.getByRole("alert").textContent?.includes("Enter a valid email"), true);
  assert.equal(saves.length, 0);
  assert.equal(updates.length, 0);
});

test("a stale revision asks for a reload and does not save again by itself", async () => {
  saveResult = { ok: false, code: "STALE_WRITE", error: "This setup changed after it was loaded. Reload and resolve the newer changes before saving." };
  render(<GuidedOnboarding model={guide()} step="sources" clients={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Save source request" }));
  const reload = await screen.findByRole("button", { name: "Reload saved setup" });
  assert.equal(saves.length, 1);
  fireEvent.click(reload);
  assert.equal(saves.length, 1);
  assert.equal(refreshCalls.length, 1);
});

test("retry reuses the same save id until the request changes", async () => {
  saveResult = { ok: false, code: null, error: "The admin API could not be reached." };
  render(<GuidedOnboarding model={guide()} step="sources" clients={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Save source request" }));
  const retry = await screen.findByRole("button", { name: "Try this save again" });
  fireEvent.click(retry);
  await screen.findByText(/could not be reached/i);
  assert.equal(saves.length, 2);
  assert.equal(saves[0]?.requestId, saves[1]?.requestId);
  assert.equal(saves[0]?.expectedRevision, saves[1]?.expectedRevision);
});

test("a missing setup configuration stays unavailable and cannot be saved", async () => {
  render(
    <GuidedOnboarding
      model={guide({
        setupWritable: false,
        setup: null,
        setupUnavailableReason: "Saving a setup request is unavailable. Native client setup is turned off.",
        destinations: null,
      })}
      step="summary"
      clients={[]}
    />
  );
  assert.equal(screen.getAllByText(/Native client setup is turned off/).length > 0, true);
  fireEvent.click(screen.getByRole("button", { name: "Save setup request" }));
  await screen.findByText(/The setup request was not changed/);
  assert.equal(saves.length, 0);
  assert.equal(updates.length, 1);
  assert.equal(JSON.stringify(updates[0]).includes("portalEnabled"), false);
});

test("a reload shows the saved request instead of an empty form", () => {
  const first = render(<GuidedOnboarding model={guide()} step="information" clients={[]} />);
  assert.equal((screen.getByLabelText("Email") as HTMLInputElement).value, "alex@example.com");
  first.rerender(
    <GuidedOnboarding
      model={guide({
        setup: {
          status: "draft",
          revision: 8,
          repairRequired: false,
          missingRequiredFields: [],
          data: { clientEmail: "updated@example.com", destinationChoice: "ghl" },
        },
      })}
      step="information"
      clients={[]}
    />
  );
  assert.equal((screen.getByLabelText("Email") as HTMLInputElement).value, "updated@example.com");
});

test("a newly created client shows that delivery is still off", () => {
  render(<GuidedOnboarding model={guide()} step="information" clients={[]} notice="created" />);
  const status = screen.getByRole("status").textContent ?? "";
  assert.equal(status.includes("Client saved"), true);
  assert.equal(status.includes("Delivery is not on"), true);
});

test("a rejected setup save clears the saving state and retries the same request", async () => {
  saveRejects = true;
  render(<GuidedOnboarding model={guide()} step="sources" clients={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Save source request" }));
  const retry = await screen.findByRole("button", { name: "Try this save again" });
  assert.equal(screen.getByRole("alert").textContent?.includes("The setup save did not finish"), true);
  assert.equal(screen.getByRole("button", { name: "Save source request" }).hasAttribute("disabled"), false);
  assert.equal(screen.queryByText("Saving the setup request. Delivery stays off."), null);
  fireEvent.click(retry);
  await screen.findByRole("button", { name: "Try this save again" });
  assert.equal(saves.length, 2);
  assert.equal(saves[0]?.requestId, saves[1]?.requestId);
});

test("a second click does not send a second setup save", async () => {
  let release: () => void = () => undefined;
  saveGate = new Promise((resolve) => {
    release = resolve;
  });
  render(<GuidedOnboarding model={guide()} step="sources" clients={[]} />);
  const button = screen.getByRole("button", { name: "Save source request" });
  fireEvent.click(button);
  fireEvent.click(button);
  assert.equal(saves.length, 1);
  release();
  await screen.findByText(/source and campaign request was saved/i);
  assert.equal(saves.length, 1);
});

test("a rejected client update can be tried again without a setup save", async () => {
  updateRejects = true;
  render(<GuidedOnboarding model={guide()} step="information" clients={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Save client information" }));
  const retry = await screen.findByRole("button", { name: "Try this save again" });
  assert.equal(screen.getByRole("alert").textContent?.includes("Saving client information did not finish"), true);
  assert.equal(saves.length, 0);
  assert.equal(updates.length, 1);
  updateRejects = false;
  fireEvent.click(retry);
  await screen.findByText(/Client information and the setup request were saved/i);
  assert.equal(updates.length, 2);
  assert.equal(saves.length, 1);
});

test("a rejected create keeps the same client id and does not send a second create until retry", async () => {
  createRejects = true;
  render(<GuidedOnboarding model={null} step="client" clients={[]} />);
  fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "Cedar Ridge" } });
  const button = screen.getByRole("button", { name: "Create client" });
  fireEvent.click(button);
  fireEvent.click(button);
  const retry = await screen.findByRole("button", { name: "Try this save again" });
  assert.equal(creates.length, 1);
  assert.equal(creates[0], "cedar_ridge");
  assert.equal(screen.getByRole("alert").textContent?.includes("Creating the client did not finish"), true);
  assert.equal((screen.getByLabelText("Client id") as HTMLInputElement).value, "cedar_ridge");
  createRejects = false;
  fireEvent.click(retry);
  await screen.findByText(/Client saved. Delivery is not on/);
  assert.deepEqual(creates, ["cedar_ridge", "cedar_ridge"]);
});

test("technical setup details are collapsed and step badges have a vertical layout", () => {
  render(<GuidedOnboarding model={guide()} step="information" clients={[]} />);
  const disclosure = screen.getByText("Technical setup details").closest("details");
  assert.ok(disclosure);
  assert.equal(disclosure.open, false);
  assert.ok(disclosure.querySelector("[data-progress-summary]"));
  const steps = screen.getByRole("list", { name: "Guided setup steps" });
  for (const button of steps.querySelectorAll("button")) {
    assert.equal(button.classList.contains("flex-col"), true);
    assert.equal(button.classList.contains("items-start"), true);
  }
});

test("partial setup keeps the notification words distinct on the summary", () => {
  render(<GuidedOnboarding model={guide()} step="summary" clients={[]} />);
  const summary = document.querySelector("[data-progress-summary]")?.textContent ?? "";
  assert.equal(/\d+ of 5/.test(summary), false);
  assert.equal(/steps saved/i.test(summary), false);
  assert.equal(/\bcomplete\b/i.test(summary), false);
  assert.equal(document.querySelector("[data-fact='destination_choice']")?.getAttribute("data-state"), "pending");
  assert.equal(document.querySelector("[data-fact='activation']")?.getAttribute("data-state"), "pending");
  assert.equal(document.querySelector("[data-fact='setup_request']")?.getAttribute("data-state"), "saved");
  assert.equal(document.querySelector("[data-fact='client_information']")?.getAttribute("data-state"), "pending");
  assert.equal(screen.getByText(/Operational: false/).textContent?.includes("does not activate"), true);
  assert.equal(screen.getByRole("heading", { name: "Remaining actions" }).textContent, "Remaining actions");
});

test("a niche selection on screen does not mark client information saved", () => {
  render(<GuidedOnboarding model={guide()} step="information" clients={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Term life" }));
  const information = screen.getAllByText("Pending").length;
  assert.equal(information > 0, true);
  assert.equal(screen.queryByText("5 of 5 steps saved"), null);
  assert.equal(document.querySelector("[data-progress-summary]")?.textContent?.includes("Client information is pending"), true);
});

test("leaving and returning keeps Northshore requests awaiting application", () => {
  const northshore = guide({
    clientAccountId: "northshore_mutual",
    account: { clientDisplayName: "Northshore Mutual", status: "onboarding", primaryNicheKeys: ["VET"], primaryProductTypes: ["final_expense"] },
    setup: {
      status: "draft",
      revision: 4,
      repairRequired: false,
      missingRequiredFields: [],
      data: { destinationChoice: "both", clientEmail: "ops@northshore.example", clientPhone: "555-0101", geography: "Florida" },
    },
    recordedSetup: { present: true, status: "draft", revision: 4, destinationChoice: "both" },
    sourceCampaignRequest: {
      availability: "ready",
      revision: 2,
      openRequest: {
        requestId: "11111111-1111-4111-8111-111111111111",
        status: "requested",
        revision: 2,
        setupRevision: 4,
        providerFunnelId: "funnel-north",
        parentUrlKey: null,
        providerCampaignId: "campaign-north",
        requestedAssociation: true,
        createdAt: "2026-11-11T17:20:00.000Z",
      },
    },
    ghlConfigurationRequest: { availability: "ready", request: { requestId: "0addf0ce-1111-4111-8111-111111111111", revision: 1 }, operational: { configured: false, deliveryActive: false } },
    companySheetsConfigurationRequest: { availability: "ready", request: { requestId: "018ffb0a-2222-4222-8222-222222222222", revision: 1 }, operational: { configured: false, deliveryActive: false } },
    verification: { availability: "unavailable" },
  });
  const view = render(<GuidedOnboarding model={northshore} step="summary" clients={[]} />);
  const before = document.querySelector("[data-progress-summary]")?.textContent ?? "";
  assert.match(before, /Request saved — awaiting application/);
  assert.equal(/5 of 5|steps saved|\bcomplete\b/i.test(before), false);
  assert.equal(document.querySelector("[data-fact='activation']")?.getAttribute("data-state"), "pending");
  assert.equal(screen.getAllByText("Request saved — awaiting application").length >= 2, true);
  fireEvent.click(screen.getByRole("button", { name: /Delivery destination/ }));
  fireEvent.click(screen.getByRole("radio", { name: "GoHighLevel" }));
  assert.equal(document.querySelector("[data-progress-summary]")?.textContent, before);
  view.rerender(<GuidedOnboarding model={northshore} step="destination" clients={[]} />);
  assert.equal(document.querySelector("[data-progress-summary]")?.textContent, before);
  view.rerender(<GuidedOnboarding model={northshore} step="summary" clients={[]} />);
  assert.equal(document.querySelector("[data-progress-summary]")?.textContent, before);
  assert.equal(screen.queryByText(/Saving a GoHighLevel location or a Company Sheets spreadsheet is not available/), null);
  assert.equal(screen.getAllByText(/Applying a request to the operational destination is a separate step/).length > 0, true);
});
