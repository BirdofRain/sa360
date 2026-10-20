"use client";

import { useState } from "react";

import type {
  CompanyGoogleConnectionView,
  CompanySheetsDestinationView,
  CompanySheetsResolvedWorksheet,
  CompanySheetsTabContractView,
} from "@/lib/admin-api/company-google-sheets";
import { Button } from "@/components/ui/button";

export type CompanySheetsAdminActions = {
  startOAuth: (clientAccountId: string) => Promise<{ ok: true; data: { authorizeUrl: string } } | { ok: false; error: string }>;
  disconnect: (clientAccountId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  saveFolder: (clientAccountId: string, folder: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  clearFolder: (clientAccountId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  resolve: (
    clientAccountId: string,
    spreadsheet: string
  ) => Promise<
    | {
        ok: true;
        data: {
          spreadsheetId: string;
          title: string;
          worksheets: CompanySheetsResolvedWorksheet[];
          controlBasis: string;
        };
      }
    | { ok: false; error: string }
  >;
  create: (clientAccountId: string) => Promise<
    | { ok: true; data: { spreadsheetId: string; title: string; worksheet: { sheetId: number; title: string }; destinationSaved: false } }
    | { ok: false; error: string }
  >;
  testAccess: (
    clientAccountId: string,
    input: { spreadsheetId: string; worksheetId: number }
  ) => Promise<{ ok: true; data: { writePermissionVerified: false } } | { ok: false; error: string }>;
  saveDestination: (
    clientAccountId: string,
    input: { spreadsheetId: string; worksheetId: number; intendedRecipientEmail?: string }
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  removeDestination: (clientAccountId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  inspectTabs?: (clientAccountId: string, exportPackageId?: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  bindTab?: (
    clientAccountId: string,
    input: { role: "campaign" | "aged" | "canary"; worksheetId: number; exportPackageId?: string }
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  createTab?: (
    clientAccountId: string,
    input: { role: "campaign" | "aged" | "canary"; exportPackageId?: string }
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}

function isGoogleAuthorizeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "accounts.google.com";
  } catch {
    return false;
  }
}

export function CompanySheetsAdminPanel({
  clientAccountId,
  clientDisplayName,
  connection,
  destination,
  notice,
  actions,
}: {
  clientAccountId: string;
  clientDisplayName: string;
  connection: CompanyGoogleConnectionView | null;
  destination: CompanySheetsDestinationView | null;
  notice: string | null;
  actions: CompanySheetsAdminActions;
}) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(notice);
  const [pending, setPending] = useState(false);
  const [spreadsheet, setSpreadsheet] = useState("");
  const [folder, setFolder] = useState("");
  const [recipient, setRecipient] = useState(destination?.sharing.intendedRecipientEmail ?? "");
  const [worksheets, setWorksheets] = useState<CompanySheetsResolvedWorksheet[]>([]);
  const [spreadsheetId, setSpreadsheetId] = useState(destination?.spreadsheetId ?? "");
  const [worksheetId, setWorksheetId] = useState<number | null>(destination?.worksheetId ?? null);
  const [tabRole, setTabRole] = useState<"campaign" | "aged" | "canary">("campaign");
  const [tabWorksheetId, setTabWorksheetId] = useState("");
  const [exportPackageId, setExportPackageId] = useState("");

  async function run(task: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) {
    setPending(true);
    setError(null);
    const result = await task();
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.message) setMessage(result.message);
  }

  const connectionLabel = connection?.connected
    ? `Connected${connection.googleEmail ? ` as ${connection.googleEmail}` : ""}`
    : connection?.reconnectRequired
      ? "Reconnect required"
      : "Not connected";

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Life Agent Launch owns the Google account. {clientDisplayName} does not connect Google
        and this page does not start lead delivery.
      </p>
      {message ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatusRow label="Connection" value={connection ? connectionLabel : "Unavailable"} />
        <StatusRow
          label="Read access"
          value={destination ? destination.accessStatus : "No destination"}
        />
        <StatusRow label="Delivery" value="Disabled — no automatic writes" />
      </div>
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Company Google account</h2>
        <p className="text-sm text-slate-600">
          Write readiness stays not verified. Saving a destination does not send existing leads.
        </p>
        {connection?.missingScopes?.length ? (
          <p className="text-sm text-amber-800">
            Missing Google scopes: {connection.missingScopes.join(", ")}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                const result = await actions.startOAuth(clientAccountId);
                if (!result.ok) return result;
                if (!isGoogleAuthorizeUrl(result.data.authorizeUrl)) {
                  return { ok: false, error: "Google did not return an authorization URL." };
                }
                window.location.assign(result.data.authorizeUrl);
                return { ok: true, message: "Redirecting to Google." };
              })
            }
          >
            Connect Life Agent Launch Google
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                const result = await actions.disconnect(clientAccountId);
                if (!result.ok) return result;
                return { ok: true, message: "Company Google account disconnected. Destinations were kept." };
              })
            }
          >
            Disconnect
          </Button>
        </div>
      </section>
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Destination folder</h2>
        <p className="text-sm text-slate-600">
          {connection?.destinationFolder
            ? `Verified folder ${connection.destinationFolder.title ?? connection.destinationFolder.folderId}. Existing spreadsheets stay where they are.`
            : "No verified folder. New spreadsheets are created in the company Drive root until a folder is verified."}
        </p>
        <label className="block text-sm text-slate-700">
          Folder URL or ID
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending || !folder.trim()}
            onClick={() =>
              void run(async () => {
                const result = await actions.saveFolder(clientAccountId, folder.trim());
                if (!result.ok) return result;
                return { ok: true, message: "Folder verified. Existing spreadsheets were not moved." };
              })
            }
          >
            Verify folder
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                const result = await actions.clearFolder(clientAccountId);
                if (!result.ok) return result;
                return { ok: true, message: "Folder cleared. Existing spreadsheets were not moved." };
              })
            }
          >
            Clear folder
          </Button>
        </div>
      </section>
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Client spreadsheet</h2>
        {destination ? (
          <div className="space-y-1 text-sm text-slate-700">
            <p>
              <a className="text-sky-700 underline" href={destination.spreadsheetUrl}>
                {destination.spreadsheetTitle ?? "Spreadsheet"}
              </a>{" "}
              / {destination.worksheetTitle}
            </p>
            <p>Control: {destination.controlBasis === "company_created" ? "Created by SA360" : "Company owner verified"}</p>
            <p>Write check: not verified. Delivery: disabled.</p>
            <p>
              {destination.sharing.missingRecipientPolicy
                ? "No client Google recipient is recorded. The portal link does not grant Google access, and the file is not shared publicly."
                : `Recipient ${destination.sharing.intendedRecipientEmail} is recorded only. Google permission has not been granted.`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">No spreadsheet is bound to this client.</p>
        )}
        <label className="block text-sm text-slate-700">
          Existing spreadsheet URL
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={spreadsheet}
            onChange={(event) => setSpreadsheet(event.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !spreadsheet.trim()}
          onClick={() =>
            void run(async () => {
              const result = await actions.resolve(clientAccountId, spreadsheet.trim());
              if (!result.ok) return result;
              setSpreadsheetId(result.data.spreadsheetId);
              setWorksheets(result.data.worksheets);
              const first = result.data.worksheets.find((sheet) => sheet.sheetType !== "OBJECT") ?? result.data.worksheets[0];
              setWorksheetId(first ? first.sheetId : null);
              return { ok: true, message: `Resolved ${result.data.title}. Choose a tab, then save.` };
            })
          }
        >
          Resolve spreadsheet
        </Button>
        {worksheets.length > 0 ? (
          <label className="block text-sm text-slate-700">
            Worksheet
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={worksheetId ?? ""}
              onChange={(event) => setWorksheetId(Number(event.target.value))}
            >
              {worksheets.map((sheet) => (
                <option key={sheet.sheetId} value={sheet.sheetId}>
                  {sheet.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block text-sm text-slate-700">
          Client Google email to record (not shared yet)
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="buyer@example.com"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pending || !spreadsheetId || worksheetId == null}
            onClick={() =>
              void run(async () => {
                if (worksheetId == null) return { ok: false, error: "Choose a worksheet." };
                const result = await actions.saveDestination(clientAccountId, {
                  spreadsheetId,
                  worksheetId,
                  ...(recipient.trim() ? { intendedRecipientEmail: recipient.trim() } : {}),
                });
                if (!result.ok) return result;
                return { ok: true, message: "Destination saved. Delivery is still disabled." };
              })
            }
          >
            Save destination
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                const result = await actions.create(clientAccountId);
                if (!result.ok) return result;
                setSpreadsheetId(result.data.spreadsheetId);
                setWorksheetId(result.data.worksheet.sheetId);
                return {
                  ok: true,
                  message: `Created ${result.data.title}. It is not the saved destination until you save it.`,
                };
              })
            }
          >
            Create spreadsheet
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !spreadsheetId || worksheetId == null}
            onClick={() =>
              void run(async () => {
                if (worksheetId == null) return { ok: false, error: "Choose a worksheet." };
                const result = await actions.testAccess(clientAccountId, { spreadsheetId, worksheetId });
                if (!result.ok) return result;
                return { ok: true, message: "Read access succeeded. Write permission was not checked." };
              })
            }
          >
            Test read access
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending || !destination}
            onClick={() =>
              void run(async () => {
                const result = await actions.removeDestination(clientAccountId);
                if (!result.ok) return result;
                return { ok: true, message: "Destination removed. The Google file was not deleted." };
              })
            }
          >
            Remove destination
          </Button>
        </div>
      </section>
      {destination ? (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Delivery tabs</h2>
          <p className="text-sm text-slate-600">
            One spreadsheet has a Campaign Leads tab and an Aged Orders tab. Inspect and bind do not
            create, rename, or overwrite tabs. Create adds a missing tab only.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["campaign", "aged", "canary"] as const).map((role) => {
              const tab = (destination.tabContracts ?? []).find((item: CompanySheetsTabContractView) => item.role === role);
              const label = role === "campaign" ? "Campaign Leads" : role === "aged" ? "Aged Orders" : "Canary";
              return (
                <StatusRow
                  key={role}
                  label={label}
                  value={
                    tab
                      ? `${tab.setupState} / ${tab.deliveryState}${tab.worksheetId == null ? "" : ` / gid ${tab.worksheetId}`}`
                      : "missing"
                  }
                />
              );
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm text-slate-700">
              Tab role
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                value={tabRole}
                onChange={(event) => setTabRole(event.target.value as "campaign" | "aged" | "canary")}
              >
                <option value="campaign">Campaign Leads</option>
                <option value="aged">Aged Orders</option>
                <option value="canary">Canary</option>
              </select>
            </label>
            <label className="block text-sm text-slate-700">
              Existing worksheet ID
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                value={tabWorksheetId}
                onChange={(event) => setTabWorksheetId(event.target.value)}
                inputMode="numeric"
              />
            </label>
            <label className="block text-sm text-slate-700">
              Authorized export package
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                value={exportPackageId}
                onChange={(event) => setExportPackageId(event.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending || !actions.inspectTabs}
              onClick={() =>
                void run(async () => {
                  if (!actions.inspectTabs) return { ok: false, error: "Inspect is unavailable." };
                  const result = await actions.inspectTabs(clientAccountId, exportPackageId.trim() || undefined);
                  if (!result.ok) return result;
                  return { ok: true, message: "Tabs inspected. No spreadsheet changes were made." };
                })
              }
            >
              Inspect tabs
            </Button>
            <Button
              type="button"
              disabled={pending || !actions.bindTab}
              onClick={() =>
                void run(async () => {
                  if (!actions.bindTab) return { ok: false, error: "Bind is unavailable." };
                  const parsed = Number(tabWorksheetId);
                  if (!Number.isInteger(parsed) || parsed < 0) return { ok: false, error: "Enter a worksheet ID." };
                  const result = await actions.bindTab(clientAccountId, {
                    role: tabRole,
                    worksheetId: parsed,
                    ...(exportPackageId.trim() ? { exportPackageId: exportPackageId.trim() } : {}),
                  });
                  if (!result.ok) return result;
                  return { ok: true, message: "Tab selected. Existing tabs were not renamed." };
                })
              }
            >
              Bind selected tab
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !actions.createTab}
              onClick={() =>
                void run(async () => {
                  if (!actions.createTab) return { ok: false, error: "Create tab is unavailable." };
                  const result = await actions.createTab(clientAccountId, {
                    role: tabRole,
                    ...(exportPackageId.trim() ? { exportPackageId: exportPackageId.trim() } : {}),
                  });
                  if (!result.ok) return result;
                  return { ok: true, message: "Missing tab created. Existing tabs were not changed." };
                })
              }
            >
              Create missing tab
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
