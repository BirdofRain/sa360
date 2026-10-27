"use client";

import { useRef, useState } from "react";
import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3, COMPANY_SHEETS_V3_COLUMNS } from "@sa360/shared";

import type {
  CompanyGoogleConnectionView,
  CompanySheetsColumnMapping,
  CompanySheetsDestinationView,
  CompanySheetsDispatchView,
  CompanySheetsFolderChoice,
  CompanySheetsFolderSpreadsheetList,
  CompanySheetsResolvedWorksheet,
  CompanySheetsTabContractView,
} from "@/lib/admin-api/company-google-sheets";
import { Button } from "@/components/ui/button";

type SectionName = "account" | "folder" | "spreadsheet" | "tabs" | "delivery";
type Note = { tone: "status" | "alert"; text: string };
type SheetCandidate = {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  worksheetId: number;
  worksheetTitle: string;
};

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
          spreadsheetUrl?: string;
          worksheets: CompanySheetsResolvedWorksheet[];
          controlBasis: string;
        };
      }
    | { ok: false; error: string }
  >;
  resolveClientFolder?: (
    clientAccountId: string,
    folder: string
  ) => Promise<{ ok: true; data: { folderId: string; title: string } } | { ok: false; error: string }>;
  prepareClientFolder?: (
    clientAccountId: string,
    input: { intent: "inspect" | "link" | "create"; folderId?: string }
  ) => Promise<
    | {
        ok: true;
        data: {
          outcome: "reused" | "created" | "linked" | "select" | "in_progress" | "unknown";
          created: boolean;
          linked: boolean;
          driveDeleted: false;
          folder: CompanySheetsFolderChoice | null;
          folders: CompanySheetsFolderChoice[];
        };
      }
    | { ok: false; error: string }
  >;
  unlinkClientFolder?: (
    clientAccountId: string
  ) => Promise<{ ok: true; data: { driveDeleted: false } } | { ok: false; error: string }>;
  listFolderSpreadsheets?: (
    clientAccountId: string,
    pageToken?: string
  ) => Promise<{ ok: true; data: CompanySheetsFolderSpreadsheetList } | { ok: false; error: string }>;
  create: (
    clientAccountId: string,
    folderId?: string
  ) => Promise<
    | {
        ok: true;
        data: {
          spreadsheetId: string;
          title: string;
          spreadsheetUrl?: string;
          worksheet: { sheetId: number; title: string };
          destinationSaved: false;
          created?: boolean;
        };
      }
    | { ok: false; error: string }
  >;
  testAccess: (
    clientAccountId: string,
    input: { spreadsheetId: string; worksheetId: number }
  ) => Promise<{ ok: true; data: { writePermissionVerified: false } } | { ok: false; error: string }>;
  sendCampaignTest?: (clientAccountId: string) => Promise<
    | {
        ok: true;
        data: {
          spreadsheetId: string;
          spreadsheetTitle: string | null;
          worksheetTitle: string;
          worksheetId: number;
          rowWritten: boolean;
          deliveryEnabled: false;
          inventoryAffected: false;
        };
      }
    | { ok: false; error: string }
  >;
  probeWrite?: (
    clientAccountId: string,
    input: { spreadsheetId: string; worksheetId: number }
  ) => Promise<
    | {
        ok: true;
        data: {
          permissionProbe: true;
          canEdit: boolean | null;
          campaignDeliveryVerified: false;
          spreadsheetTitle: string;
          worksheetTitle: string;
          matchesBoundCampaignTab: boolean;
        };
      }
    | { ok: false; error: string }
  >;
  saveDestination: (
    clientAccountId: string,
    input: { spreadsheetId: string; worksheetId: number; intendedRecipientEmail?: string }
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  removeDestination: (clientAccountId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  inspectTabs?: (clientAccountId: string, exportPackageId?: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  reviewColumns?: (
    clientAccountId: string,
    input: { schemaVersion: string; nicheKey?: string }
  ) => Promise<{ ok: true; data: CompanySheetsColumnMapping } | { ok: false; error: string }>;
  bindTab?: (
    clientAccountId: string,
    input: {
      role: "campaign" | "aged" | "canary";
      worksheetId: number;
      exportPackageId?: string;
      schemaVersion?: string;
    }
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  createTab?: (
    clientAccountId: string,
    input: { role: "campaign" | "aged" | "canary"; exportPackageId?: string; schemaVersion?: string }
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  setDispatch?: (
    clientAccountId: string,
    input: { campaignEnabled?: boolean; agedEnabled?: boolean }
  ) => Promise<
    | { ok: true; data: { campaignDispatchEnabled: boolean; campaignDispatchNotBefore: string | null } }
    | { ok: false; error: string }
  >;
};

function controlLabel(basis: string): string {
  if (basis === "company_created") return "Created by SA360";
  if (basis === "approved_shared_drive") return "Approved company shared drive";
  return "Company owner verified";
}

function sheetLink(id: string, url?: string): string {
  if (url && url.startsWith("https://docs.google.com/spreadsheets/d/")) return url;
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}`;
}

function formatEt(iso: string | null | undefined): string {
  if (!iso) return "No timestamp recorded";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)} ET`;
}

function linkHistoryLabel(link: { status: string; recordedAt: string; supersededAt: string | null }): string {
  const superseded = link.supersededAt ? ` · superseded ${formatEt(link.supersededAt)}` : "";
  if (link.status === "current") return `Current · recorded ${formatEt(link.recordedAt)}`;
  if (link.status === "inferred") {
    return `Previous · date inferred from the destination's last update at ${formatEt(link.recordedAt)}${superseded}`;
  }
  return `Previous · recorded ${formatEt(link.recordedAt)}${superseded}`;
}

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
  nicheKey,
  connection,
  destination,
  dispatch,
  notice,
  actions,
}: {
  clientAccountId: string;
  clientDisplayName: string;
  nicheKey?: string | null;
  connection: CompanyGoogleConnectionView | null;
  destination: CompanySheetsDestinationView | null;
  dispatch?: CompanySheetsDispatchView | null;
  notice: string | null;
  actions: CompanySheetsAdminActions;
}) {
  const [notes, setNotes] = useState<Partial<Record<SectionName, Note>>>({});
  const [pendingSection, setPendingSection] = useState<SectionName | null>(null);
  const pendingRef = useRef<SectionName | null>(null);
  const [spreadsheet, setSpreadsheet] = useState("");
  const [folder, setFolder] = useState("");
  const [clientFolder, setClientFolder] = useState("");
  const [verifiedClientFolderId, setVerifiedClientFolderId] = useState<string | null>(null);
  const [verifiedClientFolderTitle, setVerifiedClientFolderTitle] = useState<string | null>(null);
  const [folderChoices, setFolderChoices] = useState<CompanySheetsFolderChoice[]>([]);
  const [sheetList, setSheetList] = useState<CompanySheetsFolderSpreadsheetList | null>(null);
  const [recipient, setRecipient] = useState(destination?.sharing.intendedRecipientEmail ?? "");
  const [worksheets, setWorksheets] = useState<CompanySheetsResolvedWorksheet[]>([]);
  const [spreadsheetId, setSpreadsheetId] = useState(destination?.spreadsheetId ?? "");
  const [worksheetId, setWorksheetId] = useState<number | null>(destination?.worksheetId ?? null);
  const [candidate, setCandidate] = useState<SheetCandidate | null>(null);
  const [createdSheet, setCreatedSheet] = useState<SheetCandidate | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [tabRole, setTabRole] = useState<"campaign" | "aged" | "canary">("campaign");
  const [tabWorksheetId, setTabWorksheetId] = useState("");
  const [exportPackageId, setExportPackageId] = useState("");
  const [campaignSchema, setCampaignSchema] = useState(COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3);
  const [mapping, setMapping] = useState<CompanySheetsColumnMapping | null>(null);
  const [readProbe, setReadProbe] = useState<{ spreadsheetId: string; text: string } | null>(null);
  const [writeProbe, setWriteProbe] = useState<{ spreadsheetId: string; text: string } | null>(null);

  function note(section: SectionName, tone: Note["tone"], text: string) {
    setNotes((current) => ({ ...current, [section]: { tone, text } }));
  }

  async function run(section: SectionName, task: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) {
    if (pendingRef.current === section) return;
    pendingRef.current = section;
    setPendingSection(section);
    try {
      const result = await task();
      if (!result.ok) {
        note(section, "alert", result.error);
        return;
      }
      if (result.message) note(section, "status", result.message);
    } finally {
      if (pendingRef.current === section) pendingRef.current = null;
      setPendingSection((current) => (current === section ? null : current));
    }
  }

  function busy(section: SectionName): boolean {
    return pendingSection === section;
  }

  function SectionFeedback({ section }: { section: SectionName }) {
    const item = notes[section];
    if (!item && pendingSection !== section) return null;
    return (
      <div className="space-y-2">
        {pendingSection === section ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" role="status" aria-live="polite">
            Working…
          </p>
        ) : null}
        {item ? (
          <p
            className={
              item.tone === "alert"
                ? "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                : "rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"
            }
            role={item.tone === "alert" ? "alert" : "status"}
            aria-live={item.tone === "alert" ? "assertive" : "polite"}
          >
            {item.text}
          </p>
        ) : null}
      </div>
    );
  }

  async function loadSheets(pageToken?: string) {
    if (!actions.listFolderSpreadsheets) return;
    const listed = await actions.listFolderSpreadsheets(clientAccountId, pageToken);
    if (!listed.ok) {
      note("folder", "alert", listed.error);
      return;
    }
    setSheetList(listed.data);
  }

  function applyResolved(
    data: { spreadsheetId: string; title: string; spreadsheetUrl?: string; worksheets: CompanySheetsResolvedWorksheet[] },
    source: "resolved" | "selected"
  ): SheetCandidate | null {
    const first = data.worksheets.find((sheet) => sheet.sheetType !== "OBJECT") ?? data.worksheets[0];
    if (!first) return null;
    const next: SheetCandidate = {
      spreadsheetId: data.spreadsheetId,
      title: data.title,
      spreadsheetUrl: sheetLink(data.spreadsheetId, data.spreadsheetUrl),
      worksheetId: first.sheetId,
      worksheetTitle: first.title,
    };
    setCandidate(next);
    setSpreadsheetId(next.spreadsheetId);
    setWorksheetId(next.worksheetId);
    setWorksheets(data.worksheets);
    setConfirmReplace(false);
    if (source === "selected") setCreatedSheet(null);
    return next;
  }

  const connectionLabel = connection?.connected
    ? `Connected${connection.googleEmail ? ` as ${connection.googleEmail}` : ""}`
    : connection?.reconnectRequired
      ? "Reconnect required"
      : "Not connected";
  const deliveryOn = dispatch?.campaignDispatchEnabled === true;
  const savedId = destination?.spreadsheetId ?? "";
  const selectedId = candidate?.spreadsheetId ?? "";
  const replacing = Boolean(destination && selectedId && selectedId !== savedId);
  const liveSwapBlocked = replacing && (dispatch?.campaignDispatchEnabled === true || dispatch?.agedDispatchEnabled === true);
  const parent = connection?.destinationFolder;
  const campaignTab = (destination?.tabContracts ?? []).find((tab) => tab.role === "campaign");

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Life Agent Launch owns the Google account. {clientDisplayName} does not connect Google
        and this page does not start lead delivery.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatusRow label="Connection" value={connection ? connectionLabel : "Unavailable"} />
        <StatusRow label="Read access" value={destination ? destination.accessStatus : "No destination"} />
        <StatusRow label="Automatic delivery" value={deliveryOn ? "On" : "Off"} />
      </div>
      <section aria-label="Company Google account" aria-busy={busy("account")} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Company Google account</h2>
        {notice ? (
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900" role="status">
            {notice}
          </p>
        ) : null}
        <SectionFeedback section="account" />
        <p className="text-sm text-slate-600">
          Write readiness stays not verified. Saving a destination does not send existing leads.
        </p>
        {connection?.missingScopes?.length ? (
          <p className="text-sm text-amber-800">Missing Google scopes: {connection.missingScopes.join(", ")}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy("account")}
            onClick={() =>
              void run("account", async () => {
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
            disabled={busy("account")}
            onClick={() =>
              void run("account", async () => {
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
      <section aria-label="Client folder" aria-busy={busy("folder")} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Client folder</h2>
        <SectionFeedback section="folder" />
        <p className="text-sm text-slate-600">
          {parent ? (
            <>
              Configured parent{" "}
              <a className="text-sky-700 underline" href={`https://drive.google.com/drive/folders/${parent.folderId}`}>
                {parent.title ?? "Client Folders"}
              </a>
              . New folders use the client name {clientDisplayName}. Existing spreadsheets stay where they are.
            </>
          ) : (
            "No verified company parent. New spreadsheets stay uncreated until an approved folder is selected. They are not placed in Drive root."
          )}
        </p>
        <label className="block text-sm text-slate-700">
          Existing client subfolder
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={clientFolder}
            onChange={(event) => {
              setClientFolder(event.target.value);
              setVerifiedClientFolderId(null);
            }}
            placeholder="https://drive.google.com/drive/folders/…"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {actions.resolveClientFolder ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy("folder") || !clientFolder.trim()}
              onClick={() =>
                void run("folder", async () => {
                  const resolveClientFolder = actions.resolveClientFolder;
                  if (!resolveClientFolder) return { ok: false, error: "Client folder check is unavailable." };
                  const result = await resolveClientFolder(clientAccountId, clientFolder.trim());
                  if (!result.ok) return result;
                  setVerifiedClientFolderId(result.data.folderId);
                  setVerifiedClientFolderTitle(result.data.title);
                  await loadSheets();
                  return { ok: true, message: `Client folder ${result.data.title} is inside the approved parent.` };
                })
              }
            >
              Check subfolder
            </Button>
          ) : null}
          {actions.prepareClientFolder ? (
            <Button
              type="button"
              disabled={busy("folder")}
              onClick={() =>
                void run("folder", async () => {
                  const prepare = actions.prepareClientFolder;
                  if (!prepare) return { ok: false, error: "Create client folder is unavailable." };
                  const result = await prepare(clientAccountId, { intent: "create" });
                  if (!result.ok) return result;
                  setFolderChoices(result.data.folders);
                  if (result.data.folder && (result.data.outcome === "created" || result.data.outcome === "reused" || result.data.outcome === "linked")) {
                    setVerifiedClientFolderId(result.data.folder.folderId);
                    setVerifiedClientFolderTitle(result.data.folder.title);
                    await loadSheets();
                  }
                  if (result.data.outcome === "select") {
                    return { ok: true, message: "Matching folders found. Select one to link. Nothing was created." };
                  }
                  if (result.data.outcome === "in_progress") {
                    return { ok: true, message: "A folder creation is already in progress. It was not started again." };
                  }
                  if (result.data.outcome === "unknown") {
                    return {
                      ok: true,
                      message: "Google did not confirm the folder. It was not created again. Check the parent folder before retrying.",
                    };
                  }
                  const verb = result.data.created ? "Created" : result.data.outcome === "reused" ? "Reused" : "Linked";
                  return {
                    ok: true,
                    message: `${verb} client folder ${result.data.folder?.title ?? clientDisplayName}. The Drive folder was not deleted.`,
                  };
                })
              }
            >
              Create Client Folder
            </Button>
          ) : null}
          {actions.unlinkClientFolder ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy("folder")}
              onClick={() =>
                void run("folder", async () => {
                  const unlink = actions.unlinkClientFolder;
                  if (!unlink) return { ok: false, error: "Clear client folder is unavailable." };
                  const result = await unlink(clientAccountId);
                  if (!result.ok) return result;
                  setVerifiedClientFolderId(null);
                  setFolderChoices([]);
                  return {
                    ok: true,
                    message: "Client folder unlinked. The Drive folder, its files, and its history were kept.",
                  };
                })
              }
            >
              Clear client folder
            </Button>
          ) : null}
        </div>
        {verifiedClientFolderId ? (
          <p className="text-sm text-slate-700">
            Linked folder{" "}
            <a className="text-sky-700 underline" href={`https://drive.google.com/drive/folders/${verifiedClientFolderId}`}>
              {verifiedClientFolderTitle ?? clientDisplayName}
            </a>
          </p>
        ) : null}
        {folderChoices.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">Select a folder to link. Display names are not unique.</p>
            {folderChoices.map((choice) => (
              <div key={choice.folderId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <a className="text-sm text-sky-700 underline" href={choice.url}>
                  {choice.title}
                </a>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy("folder")}
                  onClick={() =>
                    void run("folder", async () => {
                      const prepare = actions.prepareClientFolder;
                      if (!prepare) return { ok: false, error: "Link is unavailable." };
                      const result = await prepare(clientAccountId, { intent: "link", folderId: choice.folderId });
                      if (!result.ok) return result;
                      setVerifiedClientFolderId(choice.folderId);
                      setVerifiedClientFolderTitle(choice.title);
                      setFolderChoices([]);
                      await loadSheets();
                      return { ok: true, message: `Linked ${choice.title}. The folder was not created again.` };
                    })
                  }
                >
                  Link {choice.title}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        {sheetList ? (
          <div className="space-y-2">
            {sheetList.spreadsheets.length === 0 ? (
              <p className="text-sm text-slate-600">No spreadsheets are in this folder. Create a new sheet when you are ready.</p>
            ) : (
              sheetList.spreadsheets.map((item) => (
                <div key={item.spreadsheetId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                  <a className="text-sm text-sky-700 underline" href={item.url}>
                    {item.title}
                  </a>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy("spreadsheet")}
                    onClick={() =>
                      void run("spreadsheet", async () => {
                        const result = await actions.resolve(clientAccountId, item.spreadsheetId);
                        if (!result.ok) return result;
                        const next = applyResolved({ ...result.data, spreadsheetUrl: item.url }, "selected");
                        if (!next) return { ok: false, error: "That spreadsheet has no worksheet." };
                        return { ok: true, message: `Selected ${next.title}. Not saved as destination.` };
                      })
                    }
                  >
                    Select {item.title}
                  </Button>
                </div>
              ))
            )}
            {sheetList.skipped > 0 ? (
              <p className="text-sm text-amber-800">
                {sheetList.skipped} item{sheetList.skipped === 1 ? "" : "s"} on this page could not be read or were not spreadsheets.
              </p>
            ) : null}
            {sheetList.nextPageToken && actions.listFolderSpreadsheets ? (
              <Button type="button" variant="outline" disabled={busy("folder")} onClick={() => void loadSheets(sheetList.nextPageToken ?? undefined)}>
                Load more sheets
              </Button>
            ) : null}
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-800">Recorded sheets</p>
              {sheetList.links.length === 0 && !sheetList.currentDestination ? (
                <p className="text-sm text-slate-600">No earlier sheet link is recorded.</p>
              ) : null}
              {sheetList.currentDestination &&
              !sheetList.links.some((link) => link.spreadsheetId === sheetList.currentDestination?.spreadsheetId) ? (
                <p className="text-sm text-slate-700">
                  Current destination{" "}
                  <a className="text-sky-700 underline" href={sheetList.currentDestination.spreadsheetUrl}>
                    {sheetList.currentDestination.spreadsheetTitle ?? sheetList.currentDestination.spreadsheetId}
                  </a>{" "}
                  last updated {formatEt(sheetList.currentDestination.updatedAt)}. That time is the destination row, not a recorded link event.
                </p>
              ) : null}
              {sheetList.links.map((link) => (
                <p key={`${link.spreadsheetId}-${link.status}-${link.recordedAt}`} className="text-sm text-slate-700">
                  <a className="text-sky-700 underline" href={link.spreadsheetUrl}>
                    {link.spreadsheetTitle ?? link.spreadsheetId}
                  </a>{" "}
                  {linkHistoryLabel(link)}
                </p>
              ))}
              {sheetList.folderEvents.map((event) => (
                <p key={`${event.folderId}-${event.action}-${event.createdAt}`} className="text-sm text-slate-700">
                  Folder {event.folderTitle || event.folderId} {event.action} · recorded {formatEt(event.createdAt)}
                </p>
              ))}
            </div>
          </div>
        ) : null}
        <details className="rounded-lg border border-slate-200 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-800">Advanced parent folder</summary>
          <div className="mt-3 space-y-3">
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
                disabled={busy("folder") || !folder.trim()}
                onClick={() =>
                  void run("folder", async () => {
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
                disabled={busy("folder")}
                onClick={() =>
                  void run("folder", async () => {
                    const result = await actions.clearFolder(clientAccountId);
                    if (!result.ok) return result;
                    return { ok: true, message: "Parent folder setting cleared. The Drive folder was not deleted." };
                  })
                }
              >
                Clear parent setting
              </Button>
            </div>
          </div>
        </details>
      </section>
      <section aria-label="Client spreadsheet" aria-busy={busy("spreadsheet")} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Client spreadsheet</h2>
        <SectionFeedback section="spreadsheet" />
        {destination ? (
          <div className="space-y-1 text-sm text-slate-700">
            <p>
              Saved delivery destination{" "}
              <a className="text-sky-700 underline" href={destination.spreadsheetUrl}>
                {destination.spreadsheetTitle ?? "Spreadsheet"}
              </a>{" "}
              / {destination.worksheetTitle}
            </p>
            <p>Control: {controlLabel(destination.controlBasis)}</p>
            <p>Write readiness: {destination.writeReadiness}. Saving this destination does not turn delivery on.</p>
            <p>
              {destination.sharing.missingRecipientPolicy
                ? "No client Google recipient is recorded. The portal link does not grant Google access, and the file is not shared publicly."
                : `Recipient ${destination.sharing.intendedRecipientEmail} is recorded only. Google permission has not been granted.`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">No spreadsheet is bound to this client.</p>
        )}
        {candidate && candidate.spreadsheetId !== destination?.spreadsheetId ? (
          <p className="text-sm text-slate-800">
            Selected candidate{" "}
            <a className="text-sky-700 underline" href={candidate.spreadsheetUrl}>
              {candidate.title}
            </a>
            . Not saved as destination.
          </p>
        ) : null}
        {createdSheet ? (
          <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2">
            <p className="text-sm text-slate-800">
              New sheet{" "}
              <a className="text-sky-700 underline" href={createdSheet.spreadsheetUrl}>
                {createdSheet.title}
              </a>
              . Not saved as destination.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={busy("spreadsheet")}
              onClick={() => {
                setCandidate(createdSheet);
                setSpreadsheetId(createdSheet.spreadsheetId);
                setWorksheetId(createdSheet.worksheetId);
                setWorksheets([{ sheetId: createdSheet.worksheetId, title: createdSheet.worksheetTitle, index: 0, sheetType: "GRID" }]);
                setConfirmReplace(false);
                note("spreadsheet", "status", `Selected ${createdSheet.title}. Not saved as destination.`);
              }}
            >
              Select this sheet
            </Button>
          </div>
        ) : null}
        {confirmReplace && destination && candidate ? (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <p>
              Replace the saved destination {destination.spreadsheetTitle ?? destination.spreadsheetId} with {candidate.title}?
            </p>
            <p>Tab bindings and any passing write check stay with the previous spreadsheet. Write readiness returns to not verified.</p>
          </div>
        ) : null}
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
          disabled={busy("spreadsheet") || !spreadsheet.trim()}
          onClick={() =>
            void run("spreadsheet", async () => {
              const result = await actions.resolve(clientAccountId, spreadsheet.trim());
              if (!result.ok) return result;
              const next = applyResolved(result.data, "resolved");
              if (!next) return { ok: false, error: "That spreadsheet has no worksheet." };
              return { ok: true, message: `Resolved ${next.title}. Not saved as destination.` };
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
            disabled={busy("spreadsheet") || !spreadsheetId || worksheetId == null || liveSwapBlocked}
            onClick={() =>
              void run("spreadsheet", async () => {
                if (worksheetId == null) return { ok: false, error: "Choose a worksheet." };
                if (replacing && !confirmReplace) {
                  setConfirmReplace(true);
                  return {
                    ok: true,
                    message: `Current destination ${destination?.spreadsheetTitle ?? savedId}. New target ${candidate?.title ?? spreadsheetId}. Confirm the replacement before saving.`,
                  };
                }
                const result = await actions.saveDestination(clientAccountId, {
                  spreadsheetId,
                  worksheetId,
                  ...(recipient.trim() ? { intendedRecipientEmail: recipient.trim() } : {}),
                });
                if (!result.ok) return result;
                setConfirmReplace(false);
                setCandidate(null);
                setCreatedSheet(null);
                setReadProbe(null);
                setWriteProbe(null);
                return { ok: true, message: "Destination saved. Delivery is still disabled." };
              })
            }
          >
            {confirmReplace ? "Replace destination" : "Save destination"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy("spreadsheet")}
            onClick={() =>
              void run("spreadsheet", async () => {
                const result = await actions.create(clientAccountId, verifiedClientFolderId ?? (clientFolder.trim() || undefined));
                if (!result.ok) return result;
                const next: SheetCandidate = {
                  spreadsheetId: result.data.spreadsheetId,
                  title: result.data.title,
                  spreadsheetUrl: sheetLink(result.data.spreadsheetId, result.data.spreadsheetUrl),
                  worksheetId: result.data.worksheet.sheetId,
                  worksheetTitle: result.data.worksheet.title,
                };
                setCreatedSheet(next);
                setConfirmReplace(false);
                const verb = result.data.created === false ? "Found existing sheet" : "Created";
                return { ok: true, message: `${verb} ${result.data.title}. Not saved as destination.` };
              })
            }
          >
            Create New Sheet
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy("spreadsheet") || !spreadsheetId || worksheetId == null}
            onClick={() =>
              void run("spreadsheet", async () => {
                if (worksheetId == null) return { ok: false, error: "Choose a worksheet." };
                const result = await actions.testAccess(clientAccountId, { spreadsheetId, worksheetId });
                if (!result.ok) return result;
                setReadProbe({
                  spreadsheetId,
                  text: "Read access succeeded. This is a spreadsheet permission probe, not a campaign delivery.",
                });
                return { ok: true, message: "Read access succeeded. Write permission was not checked." };
              })
            }
          >
            Test read access
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy("spreadsheet") || !spreadsheetId || worksheetId == null || !actions.probeWrite}
            onClick={() =>
              void run("spreadsheet", async () => {
                if (!actions.probeWrite || worksheetId == null) return { ok: false, error: "Write probe is unavailable." };
                const result = await actions.probeWrite(clientAccountId, { spreadsheetId, worksheetId });
                if (!result.ok) return result;
                const edit = result.data.canEdit === true ? "can edit" : result.data.canEdit === false ? "cannot edit" : "edit permission was not returned";
                const text = `Check Write Permission for ${result.data.spreadsheetTitle} / ${result.data.worksheetTitle}: ${edit}. No test row was written. Campaign delivery verified: no.`;
                setWriteProbe({ spreadsheetId, text });
                return { ok: true, message: text };
              })
            }
          >
            Check Write Permission
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy("spreadsheet") || !actions.sendCampaignTest || campaignTab?.setupState !== "bound"}
            onClick={() =>
              void run("spreadsheet", async () => {
                if (!actions.sendCampaignTest) return { ok: false, error: "Send Test Row is unavailable." };
                const result = await actions.sendCampaignTest(clientAccountId);
                if (!result.ok) return result;
                const text = `Sent one synthetic row to ${result.data.spreadsheetTitle ?? result.data.spreadsheetId} / ${result.data.worksheetTitle} (gid ${result.data.worksheetId}). No inventory lead was created. Automatic delivery was not enabled.`;
                return { ok: true, message: text };
              })
            }
          >
            Send Test Row
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy("spreadsheet") || !destination}
            onClick={() =>
              void run("spreadsheet", async () => {
                const result = await actions.removeDestination(clientAccountId);
                if (!result.ok) return result;
                return { ok: true, message: "Destination removed. The Google file was not deleted." };
              })
            }
          >
            Remove destination
          </Button>
        </div>
        {liveSwapBlocked ? (
          <p className="text-sm text-amber-800" role="status">
            Pause this client&apos;s Sheets delivery before replacing the saved spreadsheet. Saving does not turn delivery off.
          </p>
        ) : null}
        {readProbe ? (
          <p className="text-sm text-slate-700">
            {readProbe.text}
            {destination && readProbe.spreadsheetId !== destination.spreadsheetId
              ? " This read result is not for the saved destination."
              : ""}
          </p>
        ) : null}
        {writeProbe ? (
          <p className="text-sm text-slate-700">
            {writeProbe.text}
            {destination && writeProbe.spreadsheetId !== destination.spreadsheetId
              ? " This write probe is not for the saved destination."
              : ""}
          </p>
        ) : null}
      </section>
      {destination ? (
        <section aria-label="Delivery tabs" aria-busy={busy("tabs")} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Delivery tabs</h2>
          <SectionFeedback section="tabs" />
          <p className="text-sm text-slate-600">
            One spreadsheet has a Campaign Leads tab and an Aged Orders tab. Inspect and bind do not
            create, rename, or overwrite tabs. Create adds a missing tab and writes its header only when
            the new tab is empty. A new Campaign Leads tab uses the selected template. A tab already
            bound to v1 or v2 stays on that contract.
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
                      ? `${tab.setupState} / ${tab.deliveryState}${tab.schemaVersion ? ` / ${tab.schemaVersion}` : ""}${tab.worksheetId == null ? "" : ` / gid ${tab.worksheetId}`}`
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
          {tabRole === "campaign" ? (
            <div className="space-y-2">
              <label className="block text-sm text-slate-700">
                Header template
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                  value={campaignSchema}
                  onChange={(event) => setCampaignSchema(event.target.value)}
                >
                  <option value={COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3}>Shared campaign columns (v3)</option>
                  <option value="company_sheets_campaign_v2">Existing machine columns (v2)</option>
                </select>
              </label>
              {campaignSchema === COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 ? (
                <p className="text-sm text-slate-700">
                  Header preview: {COMPANY_SHEETS_V3_COLUMNS.map((column) => column.header).join(", ")}. Selecting a
                  niche does not change these columns. They are written only on a newly created empty tab.
                </p>
              ) : (
                <p className="text-sm text-slate-700">
                  v2 keeps the existing machine headers. Choosing it does not rewrite a populated sheet.
                </p>
              )}
            </div>
          ) : null}
          <p className="text-sm text-slate-600">
            Client Name is the prospect, not the purchasing agent. Date is the
            lead generation time in America/New_York. A missing source timestamp stays blank.
            {nicheKey
              ? ` Client niche on file: ${nicheKey}. That niche does not change the column template.`
              : " No niche is stored on this client."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy("tabs") || !actions.inspectTabs}
              onClick={() =>
                void run("tabs", async () => {
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
              variant="outline"
              disabled={busy("tabs") || !actions.reviewColumns}
              onClick={() =>
                void run("tabs", async () => {
                  if (!actions.reviewColumns) return { ok: false, error: "Column mapping is unavailable." };
                  const result = await actions.reviewColumns(clientAccountId, {
                    schemaVersion: tabRole === "campaign" ? campaignSchema : "company_sheets_campaign_v2",
                    ...(nicheKey ? { nicheKey } : {}),
                  });
                  if (!result.ok) return result;
                  setMapping(result.data);
                  return { ok: true, message: `Column mapping reviewed. Readiness: ${result.data.readiness}.` };
                })
              }
            >
              Review column mapping
            </Button>
            <Button
              type="button"
              disabled={busy("tabs") || !actions.bindTab}
              onClick={() =>
                void run("tabs", async () => {
                  if (!actions.bindTab) return { ok: false, error: "Bind is unavailable." };
                  const parsed = Number(tabWorksheetId);
                  if (!Number.isInteger(parsed) || parsed < 0) return { ok: false, error: "Enter a worksheet ID." };
                  const result = await actions.bindTab(clientAccountId, {
                    role: tabRole,
                    worksheetId: parsed,
                    ...(tabRole === "campaign" ? { schemaVersion: campaignSchema } : {}),
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
              disabled={busy("tabs") || !actions.createTab}
              onClick={() =>
                void run("tabs", async () => {
                  if (!actions.createTab) return { ok: false, error: "Create tab is unavailable." };
                  const result = await actions.createTab(clientAccountId, {
                    role: tabRole,
                    ...(tabRole === "campaign" ? { schemaVersion: campaignSchema } : {}),
                    ...(exportPackageId.trim() ? { exportPackageId: exportPackageId.trim() } : {}),
                  });
                  if (!result.ok) return result;
                  return { ok: true, message: "Missing tab created with its standard header. Existing tabs were not changed." };
                })
              }
            >
              Create missing tab
            </Button>
          </div>
          {mapping ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-700">
                Preset mapping for {mapping.schemaVersion}. Readiness {mapping.readiness} on{" "}
                {mapping.spreadsheetId ?? "no saved spreadsheet"} / worksheet {mapping.worksheetId ?? "none"}. This is
                the v1/v2/v3 template review. Legacy tabs are mapped in Setup & Delivery.
              </p>
              {mapping.warnings.map((warning) => (
                <p key={warning} className="text-sm text-amber-800">
                  {warning}
                </p>
              ))}
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-1 pr-3 font-medium">Column</th>
                      <th className="py-1 pr-3 font-medium">Source field</th>
                      <th className="py-1 pr-3 font-medium">Example</th>
                      <th className="py-1 font-medium">Missing source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapping.columns.map((column) => (
                      <tr key={column.header} className="border-b border-slate-100">
                        <td className="py-1 pr-3">
                          {column.header}
                          {column.systemRequired ? " (required)" : ""}
                          <span className="block text-xs text-slate-500">{column.help}</span>
                        </td>
                        <td className="py-1 pr-3">{column.sourceField}</td>
                        <td className="py-1 pr-3">{column.example || "blank"}</td>
                        <td className="py-1">{column.missingExample || "blank"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
      <section aria-label="Delivery controls" aria-busy={busy("delivery")} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Delivery controls</h2>
        <SectionFeedback section="delivery" />
        <div className="grid gap-2 sm:grid-cols-2">
          <StatusRow label="Read access" value={readProbe?.text ?? (destination ? destination.accessStatus : "No destination")} />
          <StatusRow label="Write probe" value={writeProbe ? "Permission probe only" : "Not run"} />
          <StatusRow
            label="Tab readiness"
            value={
              campaignTab?.setupState === "bound"
                ? `${campaignTab.schemaVersion ?? "bound"} on gid ${campaignTab.worksheetId ?? "unknown"}`
                : "Campaign tab is not bound"
            }
          />
          <StatusRow label="Automatic delivery" value={deliveryOn ? "On" : "Off"} />
        </div>
        <p className="text-sm text-slate-700">
          Last campaign delivery:{" "}
          {dispatch?.lastCampaignDelivery
            ? `${dispatch.lastCampaignDelivery.status} at ${formatEt(dispatch.lastCampaignDelivery.finishedAt ?? dispatch.lastCampaignDelivery.createdAt)} for ${dispatch.lastCampaignDelivery.worksheetTitle}`
            : "No campaign delivery is recorded."}
        </p>
        <p className="text-sm text-slate-600">
          {dispatch?.campaignDispatchNotBefore
            ? `Campaign cutoff ${formatEt(dispatch.campaignDispatchNotBefore)}. Enabling delivery does not move an existing cutoff earlier.`
            : "No campaign cutoff is recorded. Enabling campaign delivery sets the cutoff to that moment and does not reuse another client's cutoff."}
        </p>
        <p className="text-sm text-slate-600">
          Saving a destination does not turn delivery on. Check Write Permission does not write a row and does not
          prove a lead arrived. Send Test Row writes one synthetic row through the bound campaign writer and does not
          turn automatic delivery on. A confirmed test row is not the same as a natural client lead.
        </p>
        {dispatch?.agedDispatchEnabled ? (
          <p className="text-sm text-amber-800">Aged delivery is on. Pause it before replacing the spreadsheet.</p>
        ) : (
          <p className="text-sm text-slate-600">Aged delivery is off.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {actions.setDispatch && destination ? (
            deliveryOn ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy("delivery")}
                onClick={() =>
                  void run("delivery", async () => {
                    const setDispatch = actions.setDispatch;
                    if (!setDispatch) return { ok: false, error: "Delivery controls are unavailable." };
                    const result = await setDispatch(clientAccountId, { campaignEnabled: false });
                    if (!result.ok) return result;
                    return { ok: true, message: "Campaign delivery paused. The cutoff and existing locks were kept." };
                  })
                }
              >
                Pause campaign delivery
              </Button>
            ) : (
              <Button
                type="button"
                disabled={busy("delivery")}
                onClick={() =>
                  void run("delivery", async () => {
                    const setDispatch = actions.setDispatch;
                    if (!setDispatch) return { ok: false, error: "Delivery controls are unavailable." };
                    const result = await setDispatch(clientAccountId, { campaignEnabled: true });
                    if (!result.ok) return result;
                    return {
                      ok: true,
                      message: result.data.campaignDispatchNotBefore
                        ? `Campaign delivery enabled. Cutoff ${formatEt(result.data.campaignDispatchNotBefore)}. Global dispatch and execution are separate switches.`
                        : "Campaign delivery enabled. Global dispatch and execution are separate switches.",
                    };
                  })
                }
              >
                Enable campaign delivery
              </Button>
            )
          ) : (
            <p className="text-sm text-slate-600">
              {destination
                ? "Campaign activation is not wired on this page."
                : "Save a destination before enabling campaign delivery."}
            </p>
          )}
          {actions.setDispatch && dispatch?.agedDispatchEnabled ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy("delivery")}
              onClick={() =>
                void run("delivery", async () => {
                  const setDispatch = actions.setDispatch;
                  if (!setDispatch) return { ok: false, error: "Delivery controls are unavailable." };
                  const result = await setDispatch(clientAccountId, { agedEnabled: false });
                  if (!result.ok) return result;
                  return { ok: true, message: "Aged delivery paused. The aged cutoff was kept." };
                })
              }
            >
              Pause aged delivery
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
