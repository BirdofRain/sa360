import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import type { CampaignCommandResult, CampaignDetailView, CampaignSummaryView } from "@/lib/team-workspace/client-campaign-manager";

const VET_A = "c111111111111111111111111";
const VET_B = "c222222222222222222222222";
const NURSE = "c333333333333333333333333";
const refreshCalls: string[] = [];
const creates: Array<{ requestId: string; slug: string; displayName: string }> = [];
const updates: Array<{ requestId: string; expectedRevision: number; displayName: string }> = [];
const bindingSaves: Array<{ requestId: string; bindings: Array<{ requestedStatus: string; formId: string | null }> }> = [];
let updateImpl: (input: { requestId: string }) => Promise<CampaignCommandResult> = async () => saved("update");
let bindingImpl: (input: { requestId: string }) => Promise<CampaignCommandResult> = async () => saved("bindings");
let updateGate: Promise<void> | null = null;

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "next/navigation") {
    return { useRouter: () => ({ refresh: () => refreshCalls.push("refresh"), push: () => undefined, replace: () => undefined }) };
  }
  if (request === "@/app/actions/client-campaign-manager") {
    return {
      readClientCampaignAction: async () => ({ ok: true, detail: detail() }),
      createClientCampaignAction: async (input: { requestId: string; slug: string; displayName: string }) => {
        creates.push(input);
        return saved("create", input.requestId);
      },
      updateClientCampaignAction: async (input: { requestId: string; expectedRevision: number; displayName: string }) => {
        updates.push(input);
        if (updateGate) await updateGate;
        return updateImpl(input);
      },
      saveClientCampaignBindingsAction: async (input: {
        requestId: string;
        bindings: Array<{ requestedStatus: string; formId: string | null }>;
      }) => {
        bindingSaves.push(input);
        return bindingImpl(input);
      },
      saveClientCampaignDestinationAction: async () => saved("destination"),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let Manager: typeof import("./campaign-manager.tsx").CampaignManager;

test.before(async () => {
  ({ CampaignManager: Manager } = await import("./campaign-manager.tsx"));
});

test.afterEach(() => {
  cleanup();
  refreshCalls.length = 0;
  creates.length = 0;
  updates.length = 0;
  bindingSaves.length = 0;
  updateGate = null;
  updateImpl = async () => saved("update");
  bindingImpl = async () => saved("bindings");
});

test("two VET campaigns and one NURSE campaign render as separate records", () => {
  render(<Manager clientAccountId="client_123" canMutate model={readyModel()} />);
  assert.equal(screen.getByText(/does not route leads/i).textContent?.includes("configuration"), true);
  const rows = document.querySelectorAll("[data-campaign-niche='VET']");
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.getAttribute("data-campaign-id"), VET_A);
  assert.equal(rows[1]?.getAttribute("data-campaign-id"), VET_B);
  assert.equal(document.querySelector("[data-campaign-niche='NURSE']")?.getAttribute("data-campaign-id"), NURSE);
  assert.equal(screen.getAllByText("Vet life").length >= 2, true);
});

test("an empty list and a disabled registry do not claim a save", () => {
  const empty = render(<Manager clientAccountId="client_123" canMutate model={{ availability: "ready", campaigns: [] }} />);
  assert.equal(screen.getByText(/No saved campaigns/).textContent?.includes("does not start delivery"), true);
  empty.unmount();
  render(
    <Manager
      clientAccountId="client_123"
      canMutate
      model={{ availability: "disabled", message: "Campaign configuration is not available. Nothing was loaded and nothing was saved." }}
    />
  );
  assert.equal(screen.queryByRole("button", { name: "Save campaign draft" }), null);
  assert.match(screen.getByText(/not available/).textContent ?? "", /nothing was saved/i);
});

test("creating and editing send the registry command and a retry keeps the request id", async () => {
  render(<Manager clientAccountId="client_123" canMutate model={readyModel()} />);
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Nurse health" } });
  fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "nurse-health" } });
  fireEvent.click(screen.getByRole("button", { name: "Save campaign draft" }));
  await screen.findByText(/Saved revision 1\. This is configuration only/);
  assert.equal(creates[0]?.slug, "nurse-health");
  assert.equal(creates[0]?.displayName, "Nurse health");
  assert.match(creates[0]?.requestId ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(refreshCalls.length, 1);

  fireEvent.click(screen.getByRole("button", { name: "Open vet-life" }));
  await waitFor(() => {
    assert.equal(document.querySelector("[data-open-campaign]")?.getAttribute("data-open-campaign"), VET_A);
  });
  let release: () => void = () => undefined;
  updateGate = new Promise((resolve) => {
    release = resolve;
  });
  fireEvent.change(editorField("Display name"), { target: { value: "Vet life east" } });
  fireEvent.click(screen.getByRole("button", { name: "Save campaign details" }));
  assert.match(screen.getByText("Saving this configuration. It is not live yet.").textContent ?? "", /not live/);
  assert.equal(screen.getByRole("button", { name: "Saving this configuration" }).hasAttribute("disabled"), true);
  release();
  await screen.findByText(/Saved revision 5\. This is configuration only/);
  assert.equal(updates[0]?.expectedRevision, 4);
  assert.equal(updates[0]?.displayName, "Vet life east");

  updateImpl = async () => uncertain();
  fireEvent.change(editorField("Display name"), { target: { value: "Vet life east" } });
  fireEvent.click(screen.getByRole("button", { name: "Save campaign details" }));
  await screen.findByText(/did not finish/);
  const failedId = updates[1]?.requestId;
  fireEvent.click(screen.getByRole("button", { name: "Save campaign details" }));
  await screen.findByText(/did not finish/);
  assert.equal(updates[2]?.requestId, failedId);
  fireEvent.change(editorField("Display name"), { target: { value: "Vet life south" } });
  fireEvent.click(screen.getByRole("button", { name: "Save campaign details" }));
  await screen.findByText(/did not finish/);
  assert.notEqual(updates[3]?.requestId, failedId);
  assert.equal(refreshCalls.length, 2);
});

test("a binding review is not shown as a saved binding change", async () => {
  bindingImpl = async () => review();
  render(<Manager clientAccountId="client_123" canMutate model={readyModel()} />);
  fireEvent.click(screen.getByRole("button", { name: "Open vet-life" }));
  await waitFor(() => {
    assert.equal(document.querySelector("[data-open-campaign]")?.getAttribute("data-open-campaign"), VET_A);
  });
  fireEvent.click(screen.getByRole("button", { name: "Add source request" }));
  const key = screen.getByLabelText("Request key");
  fireEvent.change(key, { target: { value: "facebook-form" } });
  fireEvent.change(screen.getByLabelText("Request status"), { target: { value: "recorded" } });
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "facebook" } });
  fireEvent.change(screen.getByLabelText("Form id"), { target: { value: "form-9" } });
  fireEvent.click(screen.getByRole("button", { name: "Save source requests" }));
  await screen.findByText(/source binding was not changed/);
  assert.equal(document.querySelector("[data-request-state='review']"), document.querySelector("[data-request-state]"));
  assert.equal(bindingSaves[0]?.bindings[0]?.requestedStatus, "recorded");
  assert.equal(bindingSaves[0]?.bindings[0]?.formId, "form-9");
  const firstId = bindingSaves[0]?.requestId;
  fireEvent.click(screen.getByRole("button", { name: "Save source requests" }));
  await screen.findByText(/Another saved campaign already holds/);
  assert.notEqual(bindingSaves[1]?.requestId, firstId);
  assert.equal(refreshCalls.length, 0);
});

test("a reader does not get a save control", () => {
  render(<Manager clientAccountId="client_123" canMutate={false} model={readyModel()} />);
  assert.equal(screen.queryByRole("button", { name: "Save campaign draft" }), null);
  assert.match(screen.getByText(/team manager saves it/).textContent ?? "", /read/);
});

function editorField(label: string): HTMLElement {
  const root = document.querySelector("[data-open-campaign]");
  assert.ok(root);
  const match = [...root.querySelectorAll("label")].find((item) => item.textContent?.includes(label));
  const field = match?.querySelector("input,select");
  assert.ok(field instanceof HTMLElement);
  return field;
}

function readyModel() {
  return {
    availability: "ready" as const,
    campaigns: [campaign(VET_A, "vet-life"), campaign(VET_B, "vet-life-west"), campaign(NURSE, "nurse-health", "NURSE")],
  };
}

function campaign(id: string, slug: string, nicheKey = "VET"): CampaignSummaryView {
  return {
    id,
    clientAccountId: "client_123",
    slug,
    displayName: nicheKey === "NURSE" ? "Nurse health" : "Vet life",
    nicheKey,
    productType: nicheKey === "NURSE" ? "health_insurance" : "life_insurance",
    status: "draft",
    revision: 4,
    bindingCount: 0,
    destinationSaved: false,
  };
}

function detail(): CampaignDetailView {
  return { campaign: campaign(VET_A, "vet-life"), bindings: [], destination: null };
}

function saved(kind: string, requestId = "11111111-1111-4111-8111-111111111111"): CampaignCommandResult {
  const revision = kind === "update" ? 5 : 1;
  return {
    ok: true,
    uncertain: false,
    stored: true,
    recordedCommand: false,
    retainRequestId: false,
    code: null,
    outcome: null,
    message: `Saved revision ${revision}. This is configuration only. It does not route or deliver leads.`,
    revision,
    requestId,
    replayed: false,
    conflicts: [],
    campaign: {
      ...campaign(kind === "create" ? "c444444444444444444444444" : VET_A, kind === "create" ? "nurse-health" : "vet-life", kind === "create" ? "NURSE" : "VET"),
      revision,
      displayName: kind === "create" ? "Nurse health" : "Vet life",
    },
    bindings: kind === "bindings" ? [] : null,
    destination: null,
    destinationIncluded: kind !== "update",
  };
}

function uncertain(): CampaignCommandResult {
  return {
    ...saved("update"),
    ok: false,
    stored: false,
    uncertain: true,
    retainRequestId: true,
    revision: null,
    campaign: null,
    message: "The save did not finish. Retry uses the same request id. Nothing on this page was marked saved.",
  };
}

function review(): CampaignCommandResult {
  return {
    ...saved("bindings"),
    ok: false,
    stored: false,
    recordedCommand: true,
    retainRequestId: false,
    outcome: "REVIEW_REQUIRED",
    code: "review_required",
    campaign: null,
    revision: 4,
    message: "The review was recorded. The source binding was not changed.",
    conflicts: [
      {
        code: "exact_identifier_overlap",
        scope: "same_client",
        identifierKind: "form_id",
        bindingKey: "facebook-form",
        campaignId: VET_B,
      },
    ],
  };
}
