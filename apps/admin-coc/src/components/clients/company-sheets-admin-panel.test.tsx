import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { SPREADSHEET_SAVED_CHOOSE_WORKSHEET } from "@/lib/clients/onboarding/view";

import { CompanySheetsAdminPanel } from "./company-sheets-admin-panel.tsx";
import type {
  CompanyGoogleConnectionView,
  CompanySheetsDestinationView,
  SheetsReleaseCensusView,
} from "@/lib/admin-api/company-google-sheets";
import type { ColumnMapRecord } from "@/lib/clients/onboarding/types";

afterEach(() => cleanup());

const connection: CompanyGoogleConnectionView = {
  configured: true,
  status: "connected",
  connected: true,
  reconnectRequired: false,
  googleEmail: "sheets@lifeagentlaunch.test",
  googleDisplayName: "Life Agent Launch",
  connectedAt: null,
  reconnectRequiredAt: null,
  scopes: [],
  missingScopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"],
  destinationFolder: null,
  liveDeliveryEnabled: false,
  oauthAvailable: false,
  sheetsSetupAvailable: false,
};

const destination: CompanySheetsDestinationView = {
  configured: true,
  clientAccountId: "acme",
  spreadsheetId: "sheet1",
  spreadsheetTitle: "Acme Leads",
  spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet1",
  worksheetId: 0,
  worksheetTitle: "Leads",
  controlBasis: "drive_owner_verified",
  accessStatus: "readable",
  accessCheckedAt: null,
  writeReadiness: "not_verified",
  deliveryExecution: "disabled",
  liveDeliveryEnabled: false,
  enabled: false,
  sharing: {
    status: "missing_recipient",
    intendedRecipientEmail: null,
    mechanism: "explicit_user_permission_not_applied",
    anyoneWithLink: false,
    public: false,
    portalLinkGrantsGoogleAccess: false,
    clientGooglePermission: "not_granted",
    missingRecipientPolicy: true,
  },
  connection: { status: "connected", connected: true, reconnectRequired: false },
};

describe("CompanySheetsAdminPanel", () => {
  it("shows separate connection, access, and disabled delivery status", () => {
    render(
      <CompanySheetsAdminPanel
        clientAccountId="acme"
        clientDisplayName="Acme Insurance"
        connection={connection}
        destination={destination}
        notice={null}
        actions={idleActions()}
      />
    );
    assert.ok(screen.getByText("Connected as sheets@lifeagentlaunch.test"));
    assert.ok(screen.getAllByText("readable").length >= 1);
    assert.ok(screen.getAllByText("Off").length >= 1);
    assert.ok(screen.getByText(/does not start lead delivery/));
    assert.ok(screen.getByText(/No client Google recipient is recorded/));
    assert.ok(screen.getByText(/Missing Google scopes/));
  });

  it("saves a resolved destination without sending an ownership claim", async () => {
    let saved: Record<string, unknown> | null = null;
    render(
      <CompanySheetsAdminPanel
        clientAccountId="acme"
        clientDisplayName="Acme Insurance"
        connection={connection}
        destination={null}
        notice={null}
        actions={{
          ...idleActions(),
          resolve: async () => ({
            ok: true,
            data: {
              spreadsheetId: "sheet1",
              title: "Acme Leads",
              controlBasis: "drive_owner_verified",
              worksheets: [{ sheetId: 0, title: "Leads", index: 0, sheetType: "GRID" }],
            },
          }),
          saveDestination: async (_clientId, input) => {
            saved = input;
            return { ok: true };
          },
        }}
      />
    );
    fireEvent.change(screen.getByLabelText("Existing spreadsheet URL"), {
      target: { value: "https://docs.google.com/spreadsheets/d/sheet1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve spreadsheet" }));
    assert.equal(await screen.findByLabelText("Worksheet") instanceof HTMLElement, true);
    fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
    await screen.findByText("Destination saved. Delivery is still disabled.");
    assert.deepEqual(saved, { spreadsheetId: "sheet1", worksheetId: 0 });
    assert.equal(saved !== null && Object.hasOwn(saved, "createdBySa360"), false);
    assert.equal(saved !== null && Object.hasOwn(saved, "ownedByCompany"), false);
  });

  it("empty state does not invent a spreadsheet link", () => {
    render(
      <CompanySheetsAdminPanel
        clientAccountId="acme"
        clientDisplayName="Acme Insurance"
        connection={{ ...connection, connected: false, status: "disconnected", googleEmail: null }}
        destination={null}
        notice={null}
        actions={idleActions()}
      />
    );
    assert.ok(screen.getByText(/not placed in Drive root/));
    assert.ok(screen.getByText("No spreadsheet is saved for this client."));
    assert.ok(screen.getByText("Select the company folder. The approved-parent check still applies."));
    assert.ok(screen.getByText("Not connected"));
    assert.equal(screen.queryByRole("link", { name: "Acme Leads" }), null);
  });

  it("checks a client subfolder and creates the spreadsheet there", async () => {
    let checked = "";
    let createdFolder: string | undefined;
    render(
      <CompanySheetsAdminPanel
        clientAccountId="acme"
        clientDisplayName="Acme Insurance"
        connection={connection}
        destination={null}
        notice={null}
        actions={{
          ...idleActions(),
          resolveClientFolder: async (_clientId, folder) => {
            checked = folder;
            return { ok: true, data: { folderId: "1clientFolder0001", title: "Acme" } };
          },
          create: async (_clientId, folderId) => {
            createdFolder = folderId;
            return {
              ok: true,
              data: {
                spreadsheetId: "sheet-new",
                title: "Acme Leads",
                worksheet: { sheetId: 0, title: "Sheet1" },
                destinationSaved: false,
              },
            };
          },
        }}
      />
    );
    fireEvent.change(screen.getByLabelText("Existing client subfolder"), {
      target: { value: "https://drive.google.com/drive/folders/1clientFolder0001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check subfolder" }));
    await screen.findByText("Client folder Acme is inside the approved parent.");
    assert.equal(checked, "https://drive.google.com/drive/folders/1clientFolder0001");
    fireEvent.click(screen.getByRole("button", { name: "Create New Sheet" }));
    await screen.findByText(/Created Acme Leads/);
    assert.ok(screen.getAllByText(/Not saved as destination/).length >= 1);
    assert.equal(createdFolder, "1clientFolder0001");
  });

  it("keeps mapping in Google Sheets setup and drops ordinary campaign controls", () => {
    render(panelWithTabs());
    const mapping = screen.getByRole("region", { name: "Column mapping" });
    assert.equal(screen.queryByRole("region", { name: "Delivery tabs" }), null);
    assert.equal(within(mapping).queryByText("Aged Orders"), null);
    assert.equal(within(mapping).queryByText("Canary"), null);
    assert.equal(screen.queryByLabelText("Existing worksheet ID"), null);
    assert.equal(screen.queryByLabelText("Authorized export package"), null);
    assert.equal(screen.queryByText("Missing source"), null);
    assert.equal(screen.queryByRole("button", { name: "Review column mapping" }), null);
    assert.ok(within(mapping).getByRole("button", { name: "Map columns" }));
    const spreadsheet = screen.getByRole("region", { name: "Client spreadsheet" });
    fireEvent.change(within(spreadsheet).getByLabelText(/Client Google email/), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.click(within(mapping).getByRole("button", { name: "Map columns" }));
    assert.equal(
      (within(spreadsheet).getByLabelText(/Client Google email/) as HTMLInputElement).value,
      "buyer@example.com"
    );
  });

  it("restores an existing custom map after refresh", () => {
    render(
      <CompanySheetsAdminPanel
        clientAccountId="acme"
        clientDisplayName="Acme Insurance"
        connection={connection}
        destination={destination}
        notice={null}
        actions={idleActions()}
        initialColumnMap={{
          id: "map_custom",
          revision: 4,
          mapVersion: 2,
          status: "published",
          sourceScope: "shared",
          baseSchemaVersion: "legacy_custom",
          spreadsheetId: "sheet1",
          worksheetId: 0,
          worksheetTitle: "Leads",
          headerFingerprint: "fp_custom",
          headerSnapshot: ["Full Name", "Phone Number"],
          assignments: [
            {
              sheetHeader: "Full Name",
              columnIndex: 0,
              formula: false,
              target: { kind: "v3_column", header: "Client Name", sourceField: "full_name" },
              transform: "passthrough",
              decision: "mapped",
              explicit: true,
              code: null,
            },
            {
              sheetHeader: "Phone Number",
              columnIndex: 1,
              formula: false,
              target: { kind: "v3_column", header: "Phone", sourceField: "phone" },
              transform: "passthrough",
              decision: "mapped",
              explicit: true,
              code: null,
            },
          ],
          issues: [],
          preview: [],
          targets: [
            { header: "Client Name", sourceField: "full_name" },
            { header: "Phone", sourceField: "phone" },
          ],
          append: {
            behavior: "new_row_only",
            headerRow: "not_rewritten",
            existingRows: "not_rewritten",
            formulaColumns: "omitted_when_header_or_row2_starts_with_equals",
          },
        }}
      />
    );
    const mapping = screen.getByRole("region", { name: "Column mapping" });
    assert.ok(within(mapping).getByTestId("column-map-editor"));
    assert.match(within(mapping).getByTestId("column-map-state").textContent ?? "", /Published delivery configuration/);
    assert.match(within(mapping).getByTestId("column-map-state").textContent ?? "", /revision 4/);
    assert.equal(within(mapping).queryByText("Missing source"), null);
    assert.equal(screen.queryByRole("button", { name: "Map columns" }), null);
  });

  it("creates a sheet without saving it and asks before replacing a destination", async () => {
    let saved: Record<string, unknown> | null = null;
    render(
      <CompanySheetsAdminPanel
        clientAccountId="acme"
        clientDisplayName="Acme Insurance"
        connection={connection}
        destination={destination}
        notice={null}
        actions={{
          ...idleActions(),
          create: async () => ({
            ok: true,
            data: {
              spreadsheetId: "sheet-new",
              title: "Acme New",
              spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-new",
              worksheet: { sheetId: 4, title: "Sheet1" },
              destinationSaved: false,
              created: true,
            },
          }),
          saveDestination: async (_clientId, input) => {
            saved = input;
            return { ok: true };
          },
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Create New Sheet" }));
    await screen.findByRole("link", { name: "Acme New" });
    assert.equal(saved, null);
    assert.ok(screen.getAllByText(/Not saved as destination/).length >= 1);
    fireEvent.click(screen.getByRole("button", { name: "Select this sheet" }));
    fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
    await screen.findByText(/Current destination Acme Leads/);
    assert.equal(saved, null);
    fireEvent.click(screen.getByRole("button", { name: "Replace destination" }));
    await screen.findByText("Destination saved. Delivery is still disabled.");
    assert.deepEqual(saved, { spreadsheetId: "sheet-new", worksheetId: 4 });
  });

  it("distinguishes a recorded sheet link from an inferred date and a folder event", async () => {
    render(
      <CompanySheetsAdminPanel
        clientAccountId="acme"
        clientDisplayName="Acme Insurance"
        connection={connection}
        destination={destination}
        notice={null}
        actions={{
          ...idleActions(),
          resolveClientFolder: async () => ({
            ok: true,
            data: { folderId: "1folder", title: "Acme", basis: "approved_shared_drive" as const },
          }),
          listFolderSpreadsheets: async () => ({
            ok: true,
            data: {
              ok: true,
              folder: { folderId: "1folder", title: "Acme", url: "https://drive.google.com/drive/folders/1folder" },
              spreadsheets: [],
              nextPageToken: null,
              skipped: 0,
              links: [
                {
                  spreadsheetId: "sheet-old",
                  spreadsheetTitle: "Old Leads",
                  spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-old",
                  status: "inferred",
                  recordedAt: "2026-01-15T12:00:00.000Z",
                  supersededAt: "2026-10-25T16:00:00.000Z",
                },
                {
                  spreadsheetId: "sheet1",
                  spreadsheetTitle: "Current Leads",
                  spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet1",
                  status: "current",
                  recordedAt: "2026-10-25T16:00:00.000Z",
                  supersededAt: null,
                },
              ],
              folderEvents: [
                {
                  folderId: "1folder",
                  folderTitle: "Acme Insurance",
                  action: "unlinked",
                  createdAt: "2026-10-20T15:00:00.000Z",
                },
              ],
              currentDestination: null,
            },
          }),
        }}
      />
    );
    fireEvent.change(screen.getByLabelText("Existing client subfolder"), { target: { value: "1folder" } });
    fireEvent.click(screen.getByRole("button", { name: "Check subfolder" }));
    await screen.findByText(/date inferred from the destination's last update/);
    assert.ok(screen.getByText(/Current · recorded/));
    assert.match(screen.getByText(/Folder Acme Insurance unlinked/).textContent ?? "", /recorded/);
  });

  it("labels a write probe as separate from campaign delivery", async () => {
    render(
      <CompanySheetsAdminPanel
        clientAccountId="acme"
        clientDisplayName="Acme Insurance"
        connection={connection}
        destination={destination}
        notice={null}
        actions={{
          ...idleActions(),
          probeWrite: async () => ({
            ok: true,
            data: {
              permissionProbe: true as const,
              canEdit: true,
              campaignDeliveryVerified: false as const,
              spreadsheetTitle: "Acme Leads",
              worksheetTitle: "Leads",
              matchesBoundCampaignTab: false,
            },
          }),
        }}
      />
    );
    const spreadsheet = screen.getByRole("region", { name: "Client spreadsheet" });
    fireEvent.click(within(spreadsheet).getByRole("button", { name: "Check Write Permission" }));
    const matches = await within(spreadsheet).findAllByText(/No test row was written/);
    const status = matches.find((element) => element.getAttribute("role") === "status");
    assert.ok(status);
    assert.match(status.textContent ?? "", /Campaign delivery verified: no/);
  });

  it("loads the saved folder and keeps a long spreadsheet id inside the card", () => {
    const spreadsheetId = "1OUOfsYPsPzI9uFIJ_tERWAJcVk8Mg5mBtUOiVaoh-9Y";
    render(
      <CompanySheetsAdminPanel
        clientAccountId="matt_mandeville"
        clientDisplayName="Matt Mandeville"
        connection={{
          ...connection,
          destinationFolder: { folderId: "approvedParent1", title: "Client Folders", verifiedAt: "2026-10-30T12:00:00.000Z" },
        }}
        destination={{
          ...destination,
          clientAccountId: "matt_mandeville",
          spreadsheetId,
          spreadsheetTitle: "Copy of Matt",
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          tabContracts: [],
        }}
        notice={null}
        actions={idleActions()}
        initialFolderList={{
          ok: true,
          folder: {
            folderId: "1357Wlh4B3dFCZ-7KXpY9S6As4qoMjHhm",
            title: "Matthew Mandeville",
            url: "https://drive.google.com/drive/folders/1357Wlh4B3dFCZ-7KXpY9S6As4qoMjHhm",
          },
          spreadsheets: [],
          nextPageToken: null,
          skipped: 0,
          links: [],
          folderEvents: [],
          currentDestination: {
            spreadsheetId,
            spreadsheetTitle: "Copy of Matt",
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
            updatedAt: "2026-10-30T12:00:00.000Z",
          },
        }}
      />
    );
    const folder = screen.getByRole("region", { name: "Client folder" });
    assert.match(folder.textContent ?? "", /Company folder:\s*Client Folders/);
    assert.match(folder.textContent ?? "", /Saved folder/);
    assert.ok(within(folder).getByRole("link", { name: "Matthew Mandeville" }));
    const spreadsheet = screen.getByRole("region", { name: "Client spreadsheet" });
    assert.equal(spreadsheet.className.includes("overflow-hidden"), true);
    assert.ok(within(spreadsheet).getByText(SPREADSHEET_SAVED_CHOOSE_WORKSHEET));
    const id = within(spreadsheet).getByText(spreadsheetId);
    assert.equal(id.className.includes("break-all"), true);
    assert.equal(spreadsheet.contains(id), true);
  });

  it("labels the published map as delivery and the newer draft as unpublished", () => {
    render(
      <CompanySheetsAdminPanel
        clientAccountId="acme"
        clientDisplayName="Acme Insurance"
        connection={connection}
        destination={destination}
        notice={null}
        actions={idleActions()}
        initialDeliveryMap={columnMap("published", 3, 1)}
        initialUnpublishedMap={columnMap("draft", 4, 2)}
      />
    );
    const mapping = screen.getByRole("region", { name: "Column mapping" });
    assert.match(within(mapping).getByTestId("delivery-map-state").textContent ?? "", /Delivery uses published map version 1, revision 3/);
    assert.match(
      within(mapping).getByTestId("unpublished-map-state").textContent ?? "",
      /Unpublished changes: draft revision 4 is not the delivery map/
    );
    assert.match(within(mapping).getByTestId("column-map-state").textContent ?? "", /Draft revision 4/);
  });

  it("prepares one history batch without treating counts as proof", async () => {
    let calls = 0;
    render(
      <CompanySheetsAdminPanel
        clientAccountId="acme"
        clientDisplayName="Acme Insurance"
        connection={connection}
        destination={destination}
        notice={null}
        actions={{
          ...idleActions(),
          prepareSheetsHistory: async () => {
            calls += 1;
            return {
              ok: true,
              message: "Prepared one history batch. Status complete. Proof cursor_exhausted. No row was appended and delivery was not enabled.",
              census: census({ status: "complete", completenessProof: "cursor_exhausted", complete: true }),
            };
          },
        }}
        initialHistory={census({ status: "partial", completenessProof: "cursor_open", complete: false })}
      />
    );
    const section = screen.getByTestId("sheets-history-census");
    assert.match(section.textContent ?? "", /SA360 job history partial/);
    assert.match(section.textContent ?? "", /Proof cursor_open/);
    assert.match(section.textContent ?? "", /Imported Zap history 2/);
    assert.match(section.textContent ?? "", /Counts are not proof/);
    assert.match(section.textContent ?? "", /does not append a row/);
    fireEvent.click(within(section).getByRole("button", { name: "Prepare one history batch" }));
    assert.match((await screen.findByText(/Prepared one history batch/)).textContent ?? "", /cursor_exhausted/);
    assert.equal(calls, 1);
    assert.match(screen.getByTestId("sheets-history-census").textContent ?? "", /SA360 job history complete/);
  });
});

function panelWithTabs() {
  return (
    <CompanySheetsAdminPanel
      clientAccountId="acme"
      clientDisplayName="Acme Insurance"
      connection={connection}
      destination={destination}
      notice={null}
      actions={{
        ...idleActions(),
        createColumnMap: async () => ({ ok: false, error: "mapping_unresolved", detail: "not in this test" }),
      }}
    />
  );
}

function columnMap(status: string, revision: number, mapVersion: number): ColumnMapRecord {
  return {
    id: `map_${status}`,
    revision,
    mapVersion,
    status,
    sourceScope: "shared",
    baseSchemaVersion: "legacy_custom",
    spreadsheetId: "sheet1",
    worksheetId: 0,
    worksheetTitle: "Leads",
    headerFingerprint: "fp",
    headerSnapshot: ["Age/ DOB"],
    assignments: [],
    issues: [],
    preview: [],
    targets: [],
    append: {
      behavior: "new_row_only",
      headerRow: "not_rewritten",
      existingRows: "not_rewritten",
      formulaColumns: "omitted_when_header_or_row2_starts_with_equals",
    },
  };
}

function census(input: {
  status: SheetsReleaseCensusView["history"]["status"];
  completenessProof: SheetsReleaseCensusView["history"]["completenessProof"];
  complete: boolean;
}): SheetsReleaseCensusView {
  return {
    clientAccountId: "acme",
    history: {
      status: input.status,
      completenessProof: input.completenessProof,
      indexedCount: 1,
      observedJobCount: 1,
      countsAreNotProof: true,
      cursor: { createdAt: "2026-11-02T12:00:00.000Z", jobId: "job_1" },
      updatedAt: "2026-11-02T12:00:00.000Z",
      sa360JobHistoryComplete: input.complete,
    },
    admissions: {
      sa360JobIndex: { origin: "delivery_index", total: 1, byStatus: { admitted: 1 } },
      liveReservation: { origin: "live_reservation", total: 0, byStatus: {} },
      importedZapHistory: { origin: "historical_baseline", total: 2, byStatus: { admitted: 2 } },
      unknownOrigins: [],
    },
    jobs: { byKindStatus: [], open: [], openTruncated: false },
    locks: [],
    creatingTabs: [],
    quarantine: { strategy: "quarantine_until_reconciled", ran: false, count: 0, truncated: false },
    switches: {
      readOnly: true,
      campaignDispatchEnabled: false,
      campaignDispatchNotBefore: "2026-10-27T14:43:39.233Z",
      agedDispatchEnabled: false,
      agedDispatchNotBefore: null,
    },
    incomplete: ["Unimported Zap deliveries are not counted. Imported Zap history is historical_baseline and is separate from SA360 delivery_index history."],
  };
}

function idleActions() {
  return {
    startOAuth: async () => ({ ok: false as const, error: "idle" }),
    disconnect: async () => ({ ok: false as const, error: "idle" }),
    saveFolder: async () => ({ ok: false as const, error: "idle" }),
    clearFolder: async () => ({ ok: false as const, error: "idle" }),
    resolve: async () => ({ ok: false as const, error: "idle" }),
    create: async () => ({ ok: false as const, error: "idle" }),
    testAccess: async () => ({ ok: false as const, error: "idle" }),
    saveDestination: async () => ({ ok: false as const, error: "idle" }),
    removeDestination: async () => ({ ok: false as const, error: "idle" }),
  };
}
