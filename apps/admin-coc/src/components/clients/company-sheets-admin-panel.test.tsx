import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CompanySheetsAdminPanel } from "./company-sheets-admin-panel.tsx";
import type { CompanyGoogleConnectionView, CompanySheetsDestinationView } from "@/lib/admin-api/company-google-sheets";

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
    assert.ok(screen.getByText("readable"));
    assert.ok(screen.getByText("Disabled — no automatic writes"));
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
    assert.ok(screen.getByText("No spreadsheet is bound to this client."));
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
    fireEvent.click(screen.getByRole("button", { name: "Create spreadsheet" }));
    await screen.findByText(/Created Acme Leads/);
    assert.equal(createdFolder, "1clientFolder0001");
  });

  it("requests campaign schema v2 when binding or creating Campaign Leads", async () => {
    const bound: Array<Record<string, unknown>> = [];
    const created: Array<Record<string, unknown>> = [];
    render(panelWithTabs(bound, created));
    fireEvent.change(screen.getByLabelText("Existing worksheet ID"), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "Bind selected tab" }));
    await screen.findByText("Tab selected. Existing tabs were not renamed.");
    assert.deepEqual(bound, [
      { role: "campaign", worksheetId: 11, schemaVersion: "company_sheets_campaign_v2" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Create missing tab" }));
    await screen.findByText("Missing tab created. Existing tabs were not changed.");
    assert.deepEqual(created, [{ role: "campaign", schemaVersion: "company_sheets_campaign_v2" }]);
  });

  it("omits schemaVersion when binding or creating an aged tab", async () => {
    const bound: Array<Record<string, unknown>> = [];
    const created: Array<Record<string, unknown>> = [];
    render(panelWithTabs(bound, created));
    fireEvent.change(screen.getByLabelText("Tab role"), { target: { value: "aged" } });
    fireEvent.change(screen.getByLabelText("Existing worksheet ID"), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "Bind selected tab" }));
    await screen.findByText("Tab selected. Existing tabs were not renamed.");
    assert.deepEqual(bound, [{ role: "aged", worksheetId: 11 }]);
    assert.equal(Object.hasOwn(bound[0] ?? {}, "schemaVersion"), false);
    fireEvent.click(screen.getByRole("button", { name: "Create missing tab" }));
    await screen.findByText("Missing tab created. Existing tabs were not changed.");
    assert.deepEqual(created, [{ role: "aged" }]);
    assert.equal(Object.hasOwn(created[0] ?? {}, "schemaVersion"), false);
  });
});

function panelWithTabs(bound: Array<Record<string, unknown>>, created: Array<Record<string, unknown>>) {
  return (
    <CompanySheetsAdminPanel
      clientAccountId="acme"
      clientDisplayName="Acme Insurance"
      connection={connection}
      destination={destination}
      notice={null}
      actions={{
        ...idleActions(),
        bindTab: async (_clientId, input) => {
          bound.push(input);
          return { ok: true };
        },
        createTab: async (_clientId, input) => {
          created.push(input);
          return { ok: true };
        },
      }}
    />
  );
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
