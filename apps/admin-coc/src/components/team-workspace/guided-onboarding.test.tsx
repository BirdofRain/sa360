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
  if (request === "@/app/actions/team-workspace-onboarding") {
    return {
      createGuidedClientAction: async () => ({ ok: true, clientAccountId: "new_client", clientDisplayName: "New Client" }),
      updateGuidedClientAction: async (input: UpdateInput) => {
        updates.push(input);
        return { ok: true, clientAccountId: input.clientAccountId, clientDisplayName: input.clientDisplayName };
      },
      saveGuidedSetupAction: async (input: SaveInput) => {
        saves.push(input);
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
  refreshCalls.length = 0;
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

test("partial setup keeps the notification words distinct on the summary", () => {
  render(<GuidedOnboarding model={guide()} step="summary" clients={[]} />);
  assert.equal(screen.getByText("3 of 5 steps saved").textContent, "3 of 5 steps saved");
  assert.equal(document.querySelector("[data-fact='destination_choice']")?.getAttribute("data-state"), "pending");
  assert.equal(document.querySelector("[data-fact='activation']")?.getAttribute("data-state"), "pending");
  assert.equal(document.querySelector("[data-fact='setup_request']")?.getAttribute("data-state"), "saved");
  assert.equal(screen.getByText(/Operational: false/).textContent?.includes("does not activate"), true);
});
