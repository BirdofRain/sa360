import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import type {
  CompanySheetsConfigContext,
  CompanySheetsConfigHead,
  CompanySheetsConfigSubmitBody,
} from "@/lib/team-workspace/company-sheets-config-request";

const SHEET = "1a2b3c4d5e6f7g8h";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const saves: Array<CompanySheetsConfigSubmitBody & { clientAccountId: string }> = [];
let loadHead: CompanySheetsConfigHead = emptyHead();
let saveResult: "stored" | "throw" | "conflict" | "replay" = "stored";
let loadMode: "ready" | "disabled" | "different" = "ready";
const reviewed: string[] = [];

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "@/app/actions/team-workspace-company-sheets-config") {
    return {
      loadTeamWorkspaceCompanySheetsConfigurationAction: async () => {
        if (loadMode === "disabled") {
          return {
            ok: false,
            uncertain: false,
            code: "FEATURE_DISABLED",
            message: "Company Sheets configuration requests are turned off. Nothing was stored, and delivery was not changed.",
            head: null,
          };
        }
        if (loadMode === "different") {
          return { ok: true, uncertain: false, code: null, message: null, head: differentHead() };
        }
        return { ok: true, uncertain: false, code: null, message: null, head: loadHead };
      },
      saveTeamWorkspaceCompanySheetsConfigurationRequestAction: async (
        input: CompanySheetsConfigSubmitBody & { clientAccountId: string }
      ) => {
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
            message: "The configuration request changed after this page was loaded. Reload it before saving again. Nothing new was stored.",
            revision: null,
            requestId: input.requestId,
            replayed: false,
            sent: input,
            storedRequest: null,
            operationalDestination: null,
          };
        }
        if (saveResult === "replay") {
          return {
            ok: true,
            uncertain: false,
            stored: true,
            retainRequestId: false,
            needsReload: false,
            code: null,
            message: "This configuration request was already stored. The operational destination was not changed.",
            revision: input.expectedRevision,
            requestId: input.requestId,
            replayed: true,
            sent: input,
            storedRequest: storedFrom(input, input.expectedRevision),
            operationalDestination: loadHead.operationalDestination,
          };
        }
        loadHead = {
          ...loadHead,
          revision: loadHead.revision + 1,
          configuration: storedFrom(input, loadHead.revision + 1),
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
          storedRequest: loadHead.configuration,
          operationalDestination: loadHead.operationalDestination,
        };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let Panel: typeof import("./company-sheets-config-request-panel.tsx").CompanySheetsConfigRequestPanel;

test.before(async () => {
  ({ CompanySheetsConfigRequestPanel: Panel } = await import("./company-sheets-config-request-panel.tsx"));
});

test.afterEach(() => {
  cleanup();
  saves.length = 0;
  reviewed.length = 0;
  loadHead = emptyHead();
  saveResult = "stored";
  loadMode = "ready";
});

test("the request panel does not call operational writers", () => {
  const source = readFileSync(new URL("./company-sheets-config-request-panel.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("saveCompanySheetsDestination"), false);
  assert.equal(source.includes("bindCompanySheetsTab"), false);
  assert.equal(source.includes("activateCompanySheetsDispatch"), false);
  assert.equal(/activate delivery/i.test(source), false);
});

test("an operator saves a first request while dispatch stays on", async () => {
  loadHead = emptyHead();
  loadHead.operationalDestination = { exists: true, destinationRevision: 4, campaignDispatchEnabled: true, agedDispatchEnabled: false };
  renderPanel(readyContext());
  assert.equal((await screen.findByText("Operational destination revision")).parentElement?.textContent?.includes("4"), true);
  assert.equal(screen.getByText("Request-chain revision").parentElement?.textContent?.includes("2"), true);
  assert.match(screen.getByText(/does not change that destination/i).textContent ?? "", /lead delivery/i);
  assert.equal(screen.getByText("Spreadsheet recorded").parentElement?.getAttribute("data-state"), "current");
  fireEvent.click(screen.getByRole("button", { name: "Save configuration request" }));
  assert.equal(await screen.findByLabelText("Configuration request confirmation"), screen.getByLabelText("Configuration request confirmation"));
  assert.match(screen.getByLabelText("Configuration request confirmation").textContent ?? "", /not an active delivery destination/i);
  assert.match(screen.getByLabelText("Configuration request confirmation").textContent ?? "", /Campaign dispatch on/);
  assert.equal(saves.length, 1);
  assert.equal(saves[0]?.spreadsheetId, SHEET);
  assert.equal(saves[0]?.worksheetId, 101);
  assert.equal(saves[0]?.expectedRevision, 2);
  assert.equal(saves[0]?.expectedDestinationRevision, 4);
  assert.equal("spreadsheetTitle" in (saves[0] ?? {}), false);
  assert.equal(screen.getByText("Configuration request saved").parentElement?.getAttribute("data-state"), "complete");
  assert.equal(screen.getByText("Awaiting operational application").parentElement?.getAttribute("data-state"), "current");
});

test("replacing a stored request requires confirmation", async () => {
  loadHead = {
    ...emptyHead(),
    revision: 2,
    configuration: storedFrom(submitShape(REQUEST_ID), 2),
  };
  renderPanel(readyContext());
  await screen.findByLabelText("Authoritative stored request");
  const save = screen.getByRole("button", { name: "Save configuration request" }) as HTMLButtonElement;
  assert.equal(save.disabled, true);
  fireEvent.click(save);
  assert.equal(saves.length, 0);
  fireEvent.click(screen.getByRole("checkbox", { name: /Replace the stored configuration request/i }));
  fireEvent.click(screen.getByRole("button", { name: "Save configuration request" }));
  assert.equal(await screen.findByText(/configuration request was stored/i), screen.getByText(/configuration request was stored/i));
  assert.equal(saves.length, 1);
  assert.notEqual(saves[0]?.requestId, REQUEST_ID);
});

test("a lost response is retried with the same id and a different current request does not clear it", async () => {
  saveResult = "throw";
  renderPanel(readyContext());
  await screen.findByText("Request-chain revision");
  fireEvent.click(screen.getByRole("button", { name: "Save configuration request" }));
  const pending = await screen.findByText(/Unconfirmed request/i);
  const requestId = saves[0]?.requestId ?? "";
  assert.match(pending.textContent ?? "", new RegExp(requestId));
  loadMode = "different";
  fireEvent.click(screen.getByRole("button", { name: "Reload the configuration request" }));
  assert.match((await screen.findByText(/does not show whether/i)).textContent ?? "", new RegExp(requestId));
  assert.equal(screen.getByRole("button", { name: "Retry the same configuration request" }), screen.getByRole("button", { name: "Retry the same configuration request" }));
  saveResult = "replay";
  fireEvent.click(screen.getByRole("button", { name: "Retry the same configuration request" }));
  const storedMessages = await screen.findAllByText(/current stored request is 22222222-2222-4222-8222-222222222222/i);
  assert.equal(storedMessages.length > 0, true);
  assert.equal(saves.length, 2);
  assert.equal(saves[1]?.requestId, requestId);
  assert.equal(saves[1]?.worksheetId, 101);
  assert.equal(screen.queryByRole("button", { name: "Retry the same configuration request" }), null);
});

test("a stale revision blocks a new submission until reload", async () => {
  saveResult = "conflict";
  renderPanel(readyContext());
  await screen.findByText("Request-chain revision");
  fireEvent.click(screen.getByRole("button", { name: "Save configuration request" }));
  assert.match((await screen.findByText(/Reload it before saving again/i)).textContent ?? "", /Nothing new was stored/i);
  const blocked = screen.getByRole("button", { name: "Save configuration request" }) as HTMLButtonElement;
  assert.equal(blocked.disabled, true);
  fireEvent.click(blocked);
  assert.equal(saves.length, 1);
  saveResult = "stored";
  fireEvent.click(screen.getByRole("button", { name: "Reload the configuration request" }));
  assert.equal(await screen.findByText(/was reloaded/i), screen.getByText(/was reloaded/i));
  fireEvent.click(screen.getByRole("button", { name: "Save configuration request" }));
  assert.equal(saves.length, 2);
  assert.notEqual(saves[1]?.requestId, saves[0]?.requestId);
});

test("a disabled feature and a non-grid worksheet do not save", async () => {
  loadMode = "disabled";
  renderPanel(readyContext());
  assert.match((await screen.findByText(/turned off/i)).textContent ?? "", /delivery was not changed/i);
  assert.equal(screen.queryByRole("button", { name: "Save configuration request" }), null);
  cleanup();
  loadMode = "ready";
  renderPanel(readyContext({ worksheetId: 303, verification: verification([{ worksheetId: 303, title: "Chart", sheetType: "CHART" }]) }));
  assert.match((await screen.findByLabelText("Configuration request summary")).textContent ?? "", /not a grid tab/i);
  assert.equal((screen.getByRole("button", { name: "Save configuration request" }) as HTMLButtonElement).disabled, true);
  assert.equal(saves.length, 0);
});

test("reviewing the stored spreadsheet asks for a fresh read", async () => {
  loadHead = { ...emptyHead(), revision: 2, configuration: storedFrom(submitShape(REQUEST_ID), 2) };
  renderPanel(readyContext({ spreadsheetId: null, worksheetId: null, verification: null }));
  await screen.findByLabelText("Authoritative stored request");
  fireEvent.click(screen.getByRole("button", { name: "Review the stored spreadsheet" }));
  assert.deepEqual(reviewed, [SHEET]);
  assert.match(screen.getByText(/Not verified for this selection/i).textContent ?? "", /Not verified/i);
});

function renderPanel(context: CompanySheetsConfigContext) {
  return render(
    <Panel
      clientAccountId="alex_gross"
      context={context}
      onReviewStoredSpreadsheet={(spreadsheetId) => reviewed.push(spreadsheetId)}
    />
  );
}

function readyContext(overrides: Partial<CompanySheetsConfigContext> = {}): CompanySheetsConfigContext {
  return {
    connection: {
      connected: true,
      reconnectRequired: false,
      status: "connected",
      googleEmail: "sheets@lifeagentlaunch.com",
      sheetsSetupAvailable: true,
      approvedParentStored: true,
    },
    folderStatus: "recorded",
    folderDetail: "Recorded folder “Alex Gross” is inside approved company storage.",
    spreadsheetId: SHEET,
    spreadsheetInputInvalid: false,
    worksheetId: 101,
    verification: verification(),
    discoveryDestination: { exists: true, destinationRevision: 4, campaignDispatchEnabled: true, agedDispatchEnabled: false },
    ...overrides,
  };
}

function verification(worksheets = [{ worksheetId: 101, title: "Campaign Leads", sheetType: "GRID" }]) {
  return {
    spreadsheetId: SHEET,
    ok: true,
    code: null,
    title: "Alex leads",
    controlBasis: "approved_shared_drive",
    worksheets,
  };
}

function emptyHead(): CompanySheetsConfigHead {
  return {
    clientAccountId: "alex_gross",
    revision: 2,
    operationalDestination: { exists: true, destinationRevision: 4, campaignDispatchEnabled: true, agedDispatchEnabled: false },
    configuration: null,
  };
}

function differentHead(): CompanySheetsConfigHead {
  return {
    ...emptyHead(),
    revision: 4,
    configuration: {
      ...storedFrom(submitShape("22222222-2222-4222-8222-222222222222"), 4),
      worksheetId: 202,
      worksheetTitle: "Notes",
    },
  };
}

function submitShape(requestId: string): CompanySheetsConfigSubmitBody {
  return {
    requestId,
    expectedRevision: 2,
    expectedDestinationRevision: 4,
    spreadsheetId: SHEET,
    worksheetId: 101,
  };
}

function storedFrom(input: CompanySheetsConfigSubmitBody, revision: number) {
  return {
    requestId: input.requestId,
    revision,
    spreadsheetId: input.spreadsheetId,
    worksheetId: input.worksheetId,
    spreadsheetTitle: "Alex leads",
    worksheetTitle: input.worksheetId === 202 ? "Notes" : "Campaign Leads",
    controlBasis: "approved_shared_drive",
    controlCheckedAt: "2026-11-10T15:00:00.000Z",
    expectedDestinationRevision: input.expectedDestinationRevision,
    createdAt: "2026-11-10T15:00:00.000Z",
  };
}
