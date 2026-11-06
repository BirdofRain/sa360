import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "next/navigation") {
    return {
      usePathname: () => "/team-workspace/alex_gross",
      useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

import type { TeamWorkspaceClientView } from "@/lib/team-workspace/types";

let TeamWorkspaceBoard: typeof import("./workspace-board.tsx").TeamWorkspaceBoard;
let TeamWorkspaceHome: typeof import("./workspace-board.tsx").TeamWorkspaceHome;
let TeamWorkspaceLoading: typeof import("../../app/(dashboard)/team-workspace/loading.tsx").default;

const previousSupport = process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED;

test.before(async () => {
  ({ TeamWorkspaceBoard, TeamWorkspaceHome } = await import("./workspace-board.tsx"));
  ({ default: TeamWorkspaceLoading } = await import("../../app/(dashboard)/team-workspace/loading.tsx"));
});

test.afterEach(() => {
  cleanup();
  if (previousSupport === undefined) delete process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED;
  else process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED = previousSupport;
});

function view(): TeamWorkspaceClientView {
  return {
    clientAccountId: "alex_gross",
    clientDisplayName: "Alex Gross",
    accountStatus: "onboarding",
    setupLine: "Setup request: none. It is not an operational switch.",
    banner: {
      tone: "warn",
      title: "Team Workspace could not be loaded",
      body: "Nothing was saved.",
    },
    showRetry: true,
    retryHref: "/team-workspace/alex_gross",
    recordedCount: 1,
    receipts: {
      sourceLeadEventId: null,
      sheetsJobId: null,
      ghlLiveRunId: null,
      customWebhookAttemptId: null,
    },
    steps: [
      {
        id: "client_information",
        title: "Client information",
        status: "complete",
        summary: "Alex Gross is the selected client.",
        details: ["Account status: onboarding."],
      },
      {
        id: "lead_source",
        title: "Lead source / campaigns",
        status: "pending",
        summary: "No campaign rule or linked lead source is saved.",
        details: ["The client account has no campaign rule."],
      },
      {
        id: "delivery_destination",
        title: "Lead delivery destination",
        status: "unavailable",
        summary: "Delivery choices are unavailable.",
        details: ["This page did not invent a destination."],
      },
      {
        id: "delivery_notifications",
        title: "Delivery notifications",
        status: "unavailable",
        summary: "Notify this client when a lead is successfully delivered is off.",
        details: ["Nothing is emailed from Team Workspace."],
      },
      {
        id: "setup_verification",
        title: "Setup verification",
        status: "unavailable",
        summary: "Onboarding readiness is turned off.",
        details: ["This page does not confirm a live delivery."],
      },
      {
        id: "completion",
        title: "Completion / activation status",
        status: "unavailable",
        summary: "Activation cannot be judged yet.",
        details: ["operational: false."],
      },
    ],
  };
}

test("the board shows truthful step states, a disabled notification choice, and retry", () => {
  process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED = "false";
  render(
    <TeamWorkspaceBoard
      view={view()}
      clients={[
        { clientAccountId: "alex_gross", clientDisplayName: "Alex Gross", status: "onboarding" },
        { clientAccountId: "aaron_lee", clientDisplayName: "Aaron Lee", status: "active" },
      ]}
    />
  );

  assert.equal(screen.getByRole("link", { name: /Alex Gross/ }).getAttribute("aria-current"), "page");
  assert.equal(screen.getByText("Complete").textContent, "Complete");
  assert.equal(screen.getAllByText("Unavailable").length >= 3, true);
  assert.equal(screen.getByText("Pending").textContent, "Pending");
  const choice = screen.getByRole("checkbox", { name: "Notify this client when a lead is successfully delivered" });
  assert.equal((choice as HTMLInputElement).disabled, true);
  assert.equal((choice as HTMLInputElement).checked, false);
  assert.equal(screen.queryByRole("button", { name: /save|activate|enable/i }), null);
  assert.equal(screen.getByRole("link", { name: "Try again" }).getAttribute("href"), "/team-workspace/alex_gross");
  assert.equal(screen.getByText("Report issue is unavailable until support tickets are enabled.").textContent?.includes("Report issue"), true);

  fireEvent.change(screen.getByLabelText("Find a client"), { target: { value: "Aaron" } });
  assert.equal(screen.queryByRole("link", { name: /Alex Gross/ }), null);
  assert.equal(screen.getByRole("link", { name: /Aaron Lee/ }).getAttribute("href"), "/team-workspace/aaron_lee");
});

test("report issue is available on the page and on each step", () => {
  process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED = "true";
  render(<TeamWorkspaceBoard view={view()} clients={[{ clientAccountId: "alex_gross", clientDisplayName: "Alex Gross", status: "onboarding" }]} />);
  const buttons = screen.getAllByRole("button", { name: "Report issue" });
  assert.equal(buttons.length, 7);
  fireEvent.click(buttons[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Optional details" }));
  assert.equal((screen.getByLabelText("Category") as HTMLSelectElement).value, "DELIVERY");
});

test("the client list and loading state are explicit", () => {
  process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED = "false";
  render(<TeamWorkspaceHome clients={[{ clientAccountId: "alex_gross", clientDisplayName: "Alex Gross", status: "onboarding" }]} />);
  assert.equal(screen.getByRole("link", { name: /Alex Gross/ }).getAttribute("href"), "/team-workspace/alex_gross");
  cleanup();
  render(<TeamWorkspaceLoading />);
  assert.equal(screen.getByRole("status").textContent, "Loading Team Workspace…");
});
