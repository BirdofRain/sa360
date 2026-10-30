"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  actionErrorCopy,
  classificationCopy,
  FOLDER_RESOLVED_NOT_LINKED,
  ghlProofFromAttempts,
  knownProfileRevision,
  MISSING_PROFILE_REVISION_READ,
  MISSING_RESOLVED_FOLDER_BROWSE,
  schemaForClassification,
  SPREADSHEET_SAVED_CHOOSE_WORKSHEET,
  sheetsMutationGate,
  sourceIdentityLabel,
  validDriveQuery,
} from "@/lib/clients/onboarding/view";
import type {
  ColumnMapRecord,
  CompanyConnectionIdentity,
  OnboardingCampaignBind,
  OnboardingDriveSearch,
  OnboardingFolderResolve,
  OnboardingSheetPreview,
  OnboardingSheetsDestinationWrite,
  PersistedSheetsSetup,
  OnboardingSourceProof,
  OnboardingSpreadsheetListItem,
  OnboardingSummary,
  OnboardingTestAttempt,
  OnboardingWorkflowMatch,
  OnboardingWorkflowSave,
  OnboardingWorkspaceActions,
  OnboardingWorksheetPreview,
  SheetsTargetSave,
} from "@/lib/clients/onboarding/types";

import { SpreadsheetIdentity } from "@/components/clients/spreadsheet-identity";

import { ColumnMapEditor } from "./column-map-editor";
import { StatusMark } from "./status-mark";

type ChosenWorksheet = {
  spreadsheetId: string;
  spreadsheetTitle: string;
  worksheetId: number;
  worksheetTitle: string;
  classification: string;
};

function CardShell({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={testId}>
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function ProofRow({ source }: { source: OnboardingSourceProof }) {
  const observed = source.proofs.observed;
  return (
    <div className="space-y-2 rounded-lg border border-slate-100 p-3">
      <p className="font-mono text-xs text-slate-800">{sourceIdentityLabel(source)}</p>
      <p className="text-xs text-slate-500">Association {source.associationStatus}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <StatusMark label="Linked" state={source.proofs.linked.satisfied ? "yes" : "no"} />
        <StatusMark
          label="Observed"
          state={observed.satisfied ? "yes" : "no"}
          detail={
            observed.satisfied && observed.sourceLeadEventId
              ? `Latest observed lead ${observed.sourceLeadEventId}${observed.at ? ` at ${observed.at}` : ""}`
              : undefined
          }
        />
        <StatusMark
          label="Routing verified"
          state={source.proofs.routingMatched.satisfied ? "yes" : "no"}
          detail={source.proofs.routingMatched.looseRuleIgnored ? "A loose rule was ignored and is not source proof." : undefined}
        />
        <StatusMark
          label="Delivered"
          state={source.proofs.delivery.satisfied ? "yes" : "no"}
          detail={
            source.proofs.delivery.sheetsJobId || source.proofs.delivery.ghlReceiptId
              ? `Sheets ${source.proofs.delivery.sheetsJobId ?? "none"} · GHL ${source.proofs.delivery.ghlReceiptId ?? "none"}`
              : undefined
          }
        />
      </div>
      {source.proofs.linked.satisfied && !observed.satisfied ? (
        <p className="text-xs text-slate-600">Linked does not mean this source is receiving leads.</p>
      ) : null}
    </div>
  );
}

export function LeadCaptureCard({
  sources,
  evidenceTruncated,
  proofLoaded,
}: {
  sources: OnboardingSourceProof[];
  evidenceTruncated: boolean;
  proofLoaded: boolean;
}) {
  return (
    <CardShell title="LeadCapture" testId="card-leadcapture">
      {!proofLoaded ? (
        <p className="text-sm text-slate-600">Source proof was not loaded. A missing summary is not an empty source list.</p>
      ) : sources.length === 0 ? (
        <p className="text-sm text-slate-600">No LeadCapture source is stored for this client.</p>
      ) : (
        sources.map((source) => <ProofRow key={source.sourceFunnelId} source={source} />)
      )}
      {evidenceTruncated ? (
        <p className="text-xs text-amber-800">Source evidence was truncated. Older leads may be missing from this proof.</p>
      ) : null}
    </CardShell>
  );
}

export function FacebookCard({ sources, proofLoaded }: { sources: OnboardingSourceProof[]; proofLoaded: boolean }) {
  return (
    <CardShell title="Facebook" testId="card-facebook">
      <p className="text-sm text-slate-600">
        Page and form association is capture evidence. Meta capture-only is complete when it is linked and observed.
        Routing and delivery stay separate and are not failures.
      </p>
      {!proofLoaded ? (
        <p className="text-sm text-slate-600">Page and form proof was not loaded.</p>
      ) : sources.length === 0 ? (
        <p className="text-sm text-slate-600">No Facebook page and form association is stored.</p>
      ) : (
        sources.map((source) => (
          <div key={source.sourceFunnelId} className="space-y-2">
            <p className="text-xs font-medium text-slate-700">
              {source.sourceKind === "meta_lead_ads" ? "Meta Lead Ads" : "Zapier Facebook capture"}
            </p>
            {source.proofs.observed.captureOnly ? (
              <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-950">
                Capture only. This association is not active delivery and it is not a routing failure.
              </p>
            ) : (
              <p className="text-xs text-slate-600">Capture-only is not set on this source. Delivery is still a separate proof.</p>
            )}
            <ProofRow source={source} />
          </div>
        ))
      )}
    </CardShell>
  );
}

export function SheetsCard({
  clientAccountId,
  clientName,
  summary,
  connection,
  connectionError,
  dispatch,
  actions,
  sheetsSetup = null,
  onViewWorksheet,
}: {
  clientAccountId: string;
  clientName: string;
  summary: OnboardingSummary | null;
  connection: CompanyConnectionIdentity | null;
  connectionError: string | null;
  dispatch: { campaignDispatchEnabled: boolean; agedDispatchEnabled: boolean } | null;
  actions: OnboardingWorkspaceActions;
  sheetsSetup?: PersistedSheetsSetup | null;
  onViewWorksheet: (worksheet: OnboardingWorksheetPreview, spreadsheetTitle: string, spreadsheetId: string) => void;
}) {
  const [scope, setScope] = useState<"approved_parent" | "client_folder">("approved_parent");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<OnboardingDriveSearch | null>(null);
  const [resolved, setResolved] = useState<OnboardingFolderResolve | null>(null);
  const [folderUrl, setFolderUrl] = useState("");
  const [linkedFolder, setLinkedFolder] = useState<{ folderId: string; title: string } | null>(
    sheetsSetup?.folder ? { folderId: sheetsSetup.folder.folderId, title: sheetsSetup.folder.title } : null
  );
  const [spreadsheets, setSpreadsheets] = useState<OnboardingSpreadsheetListItem[] | null>(null);
  const [preview, setPreview] = useState<OnboardingSheetPreview | null>(null);
  const [chosen, setChosen] = useState<ChosenWorksheet | null>(null);
  const [explicitSave, setExplicitSave] = useState<OnboardingSheetsDestinationWrite | null>(null);
  const [explicitBind, setExplicitBind] = useState<OnboardingCampaignBind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const states = summary?.sheets;
  const mutation = sheetsMutationGate(summary, dispatch);
  const persistedSaved = states?.destinationSaved === true;
  const gateBound = summary?.gates.some((gate) => gate.id === "sheets_tab_explicitly_bound" && gate.satisfied) === true;
  const persistedBound = sheetsSetup?.campaignBound == null ? gateBound : sheetsSetup.campaignBound;
  const spreadsheetTitle = states?.spreadsheetTitle?.trim() || sheetsSetup?.spreadsheetTitle?.trim() || null;
  const spreadsheetUrl = sheetsSetup?.spreadsheetUrl ?? null;
  const companyFolder = search?.companyFolder ?? connection?.destinationFolder ?? null;
  const savedForChoice = Boolean(
    chosen &&
      ((explicitSave?.spreadsheetId === chosen.spreadsheetId && explicitSave.worksheetId === chosen.worksheetId) ||
        (persistedSaved && states?.spreadsheetId === chosen.spreadsheetId))
  );
  const storedBound = Boolean(
    chosen &&
      states?.destinationSaved &&
      states.spreadsheetId === chosen.spreadsheetId &&
      states.campaignTab === chosen.worksheetTitle &&
      summary?.gates.some((gate) => gate.id === "sheets_tab_explicitly_bound" && gate.satisfied)
  );
  const boundForChoice = Boolean(
    storedBound ||
      (chosen && explicitBind?.bound === true && explicitBind.worksheetId === chosen.worksheetId && savedForChoice)
  );

  async function run<T>(label: string, task: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, apply: (data: T) => void) {
    setPending(label);
    setError(null);
    const result = await task();
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    apply(result.data);
  }

  return (
    <CardShell title="Google Sheets" testId="card-google-sheets">
      <div className="rounded-lg border border-slate-100 p-3 text-sm">
        <p className="font-medium text-slate-900">Company Google connection</p>
        {connectionError ? <p className="mt-1 text-amber-800">{actionErrorCopy(connectionError)}</p> : null}
        {connection ? (
          <p className="mt-1 text-slate-700">
            {connection.googleDisplayName || "Company account"} · {connection.googleEmail || "email not stored"} ·{" "}
            {connection.status}
            {connection.connectedAt ? ` · connected ${connection.connectedAt}` : ""}
          </p>
        ) : (
          <p className="mt-1 text-slate-600">Company connection identity was not loaded.</p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          The company connection record does not turn on the client delivery switch. OAuth tokens stay on the server.
        </p>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <StatusMark
          label="Saved"
          state={states ? (persistedSaved ? "yes" : "no") : "unknown"}
          detail={persistedSaved ? spreadsheetTitle ?? "Spreadsheet saved" : states ? "No spreadsheet is saved" : undefined}
        />
        <StatusMark
          label="Bound"
          state={summary || sheetsSetup ? (persistedBound ? "yes" : "no") : "unknown"}
          detail={
            persistedBound
              ? states?.campaignTab ?? sheetsSetup?.campaignWorksheetTitle ?? "Campaign worksheet is bound"
              : persistedSaved
                ? SPREADSHEET_SAVED_CHOOSE_WORKSHEET
                : "No campaign worksheet is bound"
          }
        />
        <StatusMark
          label="Permission tested"
          state={states ? (states.writeReadiness === "verified" ? "yes" : "no") : "unknown"}
          detail={states?.writeReadiness ? `writeReadiness ${states.writeReadiness}` : "writeReadiness is not verified"}
        />
        <StatusMark
          label="Delivery active"
          state={states ? (states.campaignDispatchEnabled ? "yes" : "no") : "unknown"}
          detail="The client campaign switch is shown as stored. This card does not change it."
        />
      </div>
      {!states ? (
        <p className="text-sm text-slate-600">Sheets destination state was not loaded. Unknown is not the same as unsaved.</p>
      ) : persistedSaved && states.spreadsheetId ? (
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-slate-700">Saved spreadsheet</p>
          <SpreadsheetIdentity
            title={spreadsheetTitle || "Saved spreadsheet"}
            spreadsheetId={states.spreadsheetId}
            url={spreadsheetUrl}
          />
          {persistedBound ? (
            <p className="text-sm text-slate-700">Campaign worksheet {states.campaignTab ?? sheetsSetup?.campaignWorksheetTitle ?? "bound"}.</p>
          ) : (
            <p className="text-sm text-slate-800">{SPREADSHEET_SAVED_CHOOSE_WORKSHEET}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-600">No spreadsheet is saved yet. Browse the company folder or paste a folder URL. A name does not select a folder.</p>
      )}
      {linkedFolder ? (
        <p className="min-w-0 break-words text-sm text-slate-700">
          Saved folder {linkedFolder.title}
          <span className="mt-1 block break-all font-mono text-xs text-slate-500">{linkedFolder.folderId}</span>
        </p>
      ) : sheetsSetup?.folderLoaded ? (
        <p className="text-sm text-slate-600">No client folder is saved on this client.</p>
      ) : null}
      <SheetSelection
        clientAccountId={clientAccountId}
        chosen={chosen}
        saved={savedForChoice}
        bound={boundForChoice}
        persistedSaved={persistedSaved}
        persistedBound={persistedBound}
        spreadsheetTitle={spreadsheetTitle}
        mutation={mutation}
        pending={pending}
        onSave={() => {
          if (!chosen) return;
          void run("save-sheets", () => actions.saveSheetsDestination({
            spreadsheetId: chosen.spreadsheetId,
            worksheetId: chosen.worksheetId,
          }), setExplicitSave);
        }}
        onBind={() => {
          if (!chosen) return;
          void run("bind-sheet", () => actions.bindCampaignWorksheet({ worksheetId: chosen.worksheetId }), setExplicitBind);
        }}
      />
      <p className="min-w-0 text-sm text-slate-700" data-testid="company-folder-breadcrumb">
        {companyFolder ? (
          <>
            Company folder: {companyFolder.title?.trim() || companyFolder.folderId}
            <span className="mt-1 block break-all font-mono text-xs text-slate-500">{companyFolder.folderId}</span>
          </>
        ) : (
          <>
            Company folder is not on this screen yet. Browse the company folder to load its Drive name.
            <Link href={`/clients/${encodeURIComponent(clientAccountId)}/google-sheets`} className="mt-1 block text-sky-700 hover:underline">
              Set the company folder
            </Link>
          </>
        )}
      </p>
      <details open={!states?.destinationSaved} className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Find an existing folder or spreadsheet</summary>
        <div className="space-y-3 border-t border-slate-200 p-3">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!validDriveQuery(query)) {
                setError("invalid_request");
                return;
              }
              void run("search", () => actions.searchDrive({ scope, query: query.trim() }), setSearch);
            }}
          >
            <Label htmlFor="drive-query">Filter by name</Label>
            <p className="text-xs text-slate-500">
              Optional. A blank filter lists folders under the company folder. {clientName} is a hint, and a similar name is not selected automatically.
            </p>
            <div className="flex min-w-0 flex-wrap gap-2">
              <select
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                value={scope}
                onChange={(event) => setScope(event.target.value as "approved_parent" | "client_folder")}
                aria-label="Search scope"
              >
                <option value="approved_parent">Company folder</option>
                <option value="client_folder">Saved client folder</option>
              </select>
              <Input id="drive-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Optional name" className="min-w-0 max-w-sm flex-1" />
              <Button type="submit" disabled={pending !== null}>
                {pending === "search" ? "Browsing…" : "Browse company folder"}
              </Button>
            </div>
          </form>
          {search ? (
            <div className="min-w-0 space-y-2 text-sm">
              <p>Browsing saved nothing. Name match: {search.nameMatch}. Selected folder: none.</p>
              <DriveList title="Name hints" items={search.suggestions} onUseFolder={chooseFolder} />
              <DriveList title="In this folder" items={search.items} onPreview={previewItem} onUseFolder={chooseFolder} />
            </div>
          ) : null}
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run("resolve", () => actions.resolveFolder(folderUrl), setResolved);
            }}
          >
            <Label htmlFor="folder-url">Paste a Google Drive folder URL</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="folder-url"
                value={folderUrl}
                onChange={(event) => setFolderUrl(event.target.value)}
                placeholder="https://drive.google.com/drive/folders/…"
                className="max-w-lg"
              />
              <Button type="submit" variant="outline" disabled={pending !== null || !folderUrl.trim()}>
                {pending === "resolve" ? "Resolving…" : "Resolve folder"}
              </Button>
            </div>
          </form>
          {resolved ? (
            <div className="min-w-0 space-y-2 text-sm text-slate-700" data-testid="folder-resolved-not-linked">
              <p className="font-medium">{FOLDER_RESOLVED_NOT_LINKED}</p>
              <p className="break-words">
                Checked folder {resolved.folder.title}. Saved folder: no. Linked: no. Selected spreadsheet:{" "}
                {chosen?.spreadsheetId ?? "none"}. Saved destination: {persistedSaved ? "yes" : "no"}. Basis:{" "}
                {resolved.folder.basis}.
              </p>
              <p className="break-all font-mono text-xs text-slate-500">{resolved.folder.folderId}</p>
              <Button type="button" disabled={pending !== null || !actions.linkClientFolder} onClick={() => chooseFolder(resolved.folder.folderId)}>
                {pending === "link-folder" ? "Saving folder…" : "Use this folder"}
              </Button>
              {!actions.linkClientFolder && resolved.next && actions.browseResolvedFolder ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending !== null}
                  onClick={() => {
                    const browse = actions.browseResolvedFolder;
                    if (!browse) return;
                    void run("browse-resolved", () => browse(resolved.folder.folderId), setSpreadsheets);
                  }}
                >
                  {pending === "browse-resolved" ? "Loading spreadsheets…" : "Browse spreadsheets in this folder"}
                </Button>
              ) : null}
              {!actions.linkClientFolder && !actions.browseResolvedFolder ? (
                <p className="text-xs text-slate-600">{MISSING_RESOLVED_FOLDER_BROWSE}</p>
              ) : null}
              <p className="text-xs text-slate-500">Use this folder saves the Drive folder on this client. It does not save a spreadsheet.</p>
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void run("browse", () => actions.listSpreadsheets(), setSpreadsheets)}
          >
            {pending === "browse" ? "Loading spreadsheets…" : "Browse linked folder"}
          </Button>
          <p className="text-xs text-slate-500">
            Browse linked folder lists the folder already saved on this client. It does not save a spreadsheet destination.
          </p>
          {spreadsheets ? (
            <ul className="space-y-2 text-sm">
              {spreadsheets.length === 0 ? <li>No spreadsheets are listed in the linked folder.</li> : null}
              {spreadsheets.map((item) => (
                <li key={item.spreadsheetId} className="flex flex-wrap items-center gap-2">
                  <span>{item.title}</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => previewItem(item.spreadsheetId)}>
                    Preview worksheets
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
      {spreadsheets ? (
        <p className="text-xs text-slate-500">These rows are from the linked folder, not from an unsaved resolved folder.</p>
      ) : null}
      {preview ? (
        <WorksheetPreview
          preview={preview}
          onView={(worksheet, spreadsheetTitle) => onViewWorksheet(worksheet, spreadsheetTitle, preview.spreadsheetId)}
          onChoose={(worksheet) =>
            setChosen({
              spreadsheetId: preview.spreadsheetId,
              spreadsheetTitle: preview.spreadsheetTitle,
              worksheetId: worksheet.worksheetId,
              worksheetTitle: worksheet.title,
              classification: worksheet.classification,
            })
          }
          actions={actions}
          campaignDispatchEnabled={states?.campaignDispatchEnabled === true}
        />
      ) : null}
      {error ? (
        <p className="text-sm text-amber-800" role="status">
          {actionErrorCopy(error)}
        </p>
      ) : null}
    </CardShell>
  );

  function previewItem(spreadsheetId: string) {
    void run("preview", () => actions.previewSpreadsheet(spreadsheetId), setPreview);
  }

  function chooseFolder(folderId: string) {
    const link = actions.linkClientFolder;
    if (!link) {
      setError("folder_unavailable");
      return;
    }
    void run("link-folder", () => link(folderId), (data) => {
      setLinkedFolder({ folderId: data.folderId, title: data.title });
      setSpreadsheets(data.spreadsheets);
      setResolved(null);
    });
  }
}

function DriveList({
  title,
  items,
  onPreview,
  onUseFolder,
}: {
  title: string;
  items: OnboardingDriveSearch["items"];
  onPreview?: (id: string) => void;
  onUseFolder?: (id: string) => void;
}) {
  if (items.length === 0) return <p className="text-xs text-slate-500">{title}: none</p>;
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-slate-600">{title}</p>
      <ul className="mt-1 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="min-w-0 rounded-md border border-slate-100 px-2 py-2 text-xs">
            <p className="break-words text-slate-900">
              {item.title} · {item.kind}
              {item.reason ? ` · ${item.reason}` : ""}
            </p>
            {item.location ? <p className="mt-1 break-all text-slate-500">{item.location}</p> : null}
            <div className="mt-2">
              {item.kind === "folder" && item.selectable && onUseFolder ? (
                <Button
                  type="button"
                  size="xs"
                  aria-label={`Use this folder ${item.title} ${item.location ?? item.id}`}
                  onClick={() => onUseFolder(item.id)}
                >
                  Use this folder
                </Button>
              ) : item.kind === "spreadsheet" && item.selectable && onPreview ? (
                <Button type="button" size="xs" variant="outline" onClick={() => onPreview(item.id)}>
                  Preview
                </Button>
              ) : (
                <span>{item.selectable ? "Selectable" : "Not selectable"}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SheetSelection({
  clientAccountId,
  chosen,
  saved,
  bound,
  persistedSaved,
  persistedBound,
  spreadsheetTitle,
  mutation,
  pending,
  onSave,
  onBind,
}: {
  clientAccountId: string;
  chosen: ChosenWorksheet | null;
  saved: boolean;
  bound: boolean;
  persistedSaved: boolean;
  persistedBound: boolean;
  spreadsheetTitle: string | null;
  mutation: ReturnType<typeof sheetsMutationGate>;
  pending: string | null;
  onSave: () => void;
  onBind: () => void;
}) {
  const canWrite = mutation === "allowed" && chosen != null && chosen.classification !== "stats_excluded";
  const reason =
    mutation === "active"
      ? "Client delivery is already on. This workspace will not pause, replace, or bind a different destination."
      : mutation === "unknown"
        ? "The client delivery switch is unknown, so save and bind stay unavailable."
        : !chosen
          ? "Choose a worksheet after preview. Preview and resolve do not save or bind."
          : chosen.classification === "stats_excluded"
            ? "Stats worksheets are preserved and cannot be the campaign destination."
            : saved
              ? "The spreadsheet is the saved destination. Bind is a separate explicit step."
              : "The worksheet is selected and is not saved.";
  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-slate-200 p-3 text-sm" data-testid="sheet-selection">
      <p className="break-words">
        {chosen
          ? `Selected spreadsheet ${chosen.spreadsheetTitle}. Selected worksheet ${chosen.worksheetTitle}. Header ${chosen.classification}. Unsaved selection: ${saved ? "no" : "yes"}. Saved destination: ${saved ? "yes" : "no"}. Bound: ${bound ? "yes" : "no"}.`
          : persistedSaved
            ? persistedBound
              ? `Saved spreadsheet ${spreadsheetTitle ?? "saved"}. Bound: yes.`
              : SPREADSHEET_SAVED_CHOOSE_WORKSHEET
            : "No worksheet is selected. Preview does not select, save, or bind."}
      </p>
      {chosen ? <p className="break-all font-mono text-xs text-slate-500">{chosen.spreadsheetId}</p> : null}
      <p className="text-xs text-slate-600">{reason}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" data-testid="save-spreadsheet-destination" disabled={!canWrite || pending !== null} onClick={onSave}>
          {pending === "save-sheets" ? "Saving destination…" : "Save spreadsheet destination"}
        </Button>
        <Button
          type="button"
          variant="outline"
          data-testid="bind-selected-worksheet"
          disabled={!canWrite || !saved || pending !== null}
          onClick={onBind}
        >
          {pending === "bind-sheet" ? "Binding worksheet…" : "Bind selected worksheet"}
        </Button>
      </div>
      <p className="text-xs text-slate-600">
        {mutation === "allowed"
          ? "Save uses the existing company Sheets destination write and does not mark the campaign tab bound. Bind uses the existing campaign tab binder and does not create a worksheet."
          : "Finish save and bind in the existing Google Sheets setup. This workspace will not change an active destination."}
      </p>
      <Link
        href={`/clients/${encodeURIComponent(clientAccountId)}/google-sheets`}
        className="text-sm text-sky-700 hover:underline"
      >
        Open the existing Google Sheets setup
      </Link>
      <ul className="list-disc pl-5 text-xs text-slate-600">
        <li>Locate the spreadsheet: {chosen ? "selected" : "not selected"}</li>
        <li>Inspect worksheets: use Preview worksheets. Preview is not a save.</li>
        <li>Campaign worksheet: {chosen ? chosen.worksheetTitle : "not chosen"}</li>
        <li>Saved spreadsheet: {persistedSaved || saved ? "yes" : "no"}</li>
        <li>Unsaved selection: {chosen && !saved ? "yes" : "no"}</li>
        <li>Bound worksheet: {persistedBound || bound ? "yes" : "no"}</li>
      </ul>
    </div>
  );
}

function WorksheetPreview({
  preview,
  onView,
  onChoose,
  actions,
  campaignDispatchEnabled,
}: {
  preview: OnboardingSheetPreview;
  onView: (worksheet: OnboardingWorksheetPreview, spreadsheetTitle: string) => void;
  onChoose: (worksheet: OnboardingWorksheetPreview) => void;
  actions: OnboardingWorkspaceActions;
  campaignDispatchEnabled: boolean;
}) {
  const [target, setTarget] = useState<SheetsTargetSave | null>(null);
  const [map, setMap] = useState<ColumnMapRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  async function selectTab(sheet: OnboardingWorksheetPreview, createMap: boolean) {
    if (campaignDispatchEnabled) return;
    setPendingId(sheet.worksheetId);
    setError(null);
    if (actions.saveSheetsTarget) {
      const saved = await actions.saveSheetsTarget({
        spreadsheetId: preview.spreadsheetId,
        worksheetId: sheet.worksheetId,
      });
      if (!saved.ok) {
        setPendingId(null);
        setError(saved.error);
        return;
      }
      setTarget(saved.data);
    }
    if (!createMap || !actions.createColumnMap) {
      setPendingId(null);
      setMap(null);
      return;
    }
    const created = await actions.createColumnMap({
      spreadsheetId: preview.spreadsheetId,
      worksheetId: sheet.worksheetId,
    });
    setPendingId(null);
    if (!created.ok) {
      setError(created.error);
      return;
    }
    setMap(created.data);
  }

  return (
    <div className="space-y-3" data-testid="worksheet-preview">
      <p className="text-sm font-medium text-slate-900">
        {preview.spreadsheetTitle} · preview saved: no
        {preview.selection ? " · selection applied: no · bound: no" : ""}
      </p>
      <p className="min-w-0 break-all font-mono text-xs text-slate-700">Spreadsheet {preview.spreadsheetId}</p>
      {preview.recommendation ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          Recommended: {preview.recommendation.title} is an exact v3 header. It is not selected, not saved, and not bound.
          {preview.recommendation.existingBinding ? " A campaign binding already points at this worksheet." : " Binding still requires an explicit action elsewhere."}
        </p>
      ) : null}
      {campaignDispatchEnabled ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Pause campaign Sheets delivery before changing the target or the column map.
        </p>
      ) : null}
      <ul className="space-y-3">
        {preview.worksheets.map((sheet) => {
          const stats = sheet.classification === "stats_excluded" || sheet.classification === "not_grid";
          const known = sheet.classification === "v3_exact_header" || sheet.classification === "known_schema_exact";
          const mappable =
            sheet.classification === "legacy_custom_required" || sheet.classification === "v3_prefix_with_extra_columns";
          const schema = schemaForClassification(sheet.classification);
          return (
            <li key={sheet.worksheetId} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{sheet.title}</p>
                {stats ? (
                  <span className="text-xs text-slate-500">Preserved. Not a delivery target.</span>
                ) : (
                  <span className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => onView(sheet, preview.spreadsheetTitle)}>
                      View worksheet
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => onChoose(sheet)}>
                      Choose this worksheet
                    </Button>
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-[11px] text-slate-600">worksheet gid {sheet.worksheetId}</p>
              <p className="mt-1 text-xs text-slate-600">
                {classificationCopy(sheet.classification)}
                {schema ? ` Schema ${schema}.` : ""}
              </p>
              {known ? (
                <p className="mt-1 text-xs text-slate-700">
                  This header matches an existing campaign schema. Use that bind. A custom map is not created for this tab.
                </p>
              ) : null}
              {sheet.historicalDataRows === "has_rows" ? (
                <p className="mt-1 text-xs text-slate-700">
                  Historical rows preserved ({sheet.historicalDataRowCount ?? "count stored"}). Preview does not rewrite them.
                </p>
              ) : null}
              {sheet.historicalDataRows === "truncated" ? (
                <p className="mt-1 text-xs text-amber-800">Row probe was truncated. This header check is incomplete.</p>
              ) : null}
              <p className="mt-2 text-xs text-slate-500">Exact header · {sheet.headerColumnCount} columns. Headers are read and not rewritten.</p>
              <ol className="mt-1 max-h-28 overflow-auto font-mono text-[11px] leading-5 text-slate-800">
                {sheet.header.map((cell, index) => (
                  <li key={`${sheet.worksheetId}-${index}`}>
                    {index + 1}. {cell || "(blank header)"}
                  </li>
                ))}
              </ol>
              {known && actions.saveSheetsTarget ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={campaignDispatchEnabled || pendingId !== null}
                  onClick={() => void selectTab(sheet, false)}
                >
                  {pendingId === sheet.worksheetId ? "Saving tab…" : "Select this tab"}
                </Button>
              ) : null}
              {mappable && actions.createColumnMap ? (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-slate-700">Map columns reads these headers. It does not overwrite them or apply the preset template.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={campaignDispatchEnabled || pendingId !== null}
                    onClick={() => void selectTab(sheet, true)}
                  >
                    {pendingId === sheet.worksheetId ? "Reading headers…" : "Map columns"}
                  </Button>
                </div>
              ) : null}
              {map && map.worksheetId === sheet.worksheetId && map.spreadsheetId === preview.spreadsheetId ? (
                <ColumnMapEditor
                  key={map.id}
                  record={map}
                  target={target}
                  campaignDispatchEnabled={campaignDispatchEnabled}
                  actions={actions}
                  onChange={setMap}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="text-sm text-amber-800" role="status">
          {actionErrorCopy(error)}
        </p>
      ) : null}
    </div>
  );
}

export function GhlCard({
  clientAccountId,
  summary,
  actions,
  attempts,
  profileRevision,
}: {
  clientAccountId: string;
  summary: OnboardingSummary | null;
  actions: OnboardingWorkspaceActions;
  attempts: OnboardingTestAttempt[];
  profileRevision: number | null;
}) {
  const [match, setMatch] = useState<OnboardingWorkflowMatch | null>(null);
  const [saved, setSaved] = useState<OnboardingWorkflowSave | null>(null);
  const [revision, setRevision] = useState<number | null>(knownProfileRevision(profileRevision));
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function saveSelection(workflowId: string, workflowName: string) {
    if (revision == null) return;
    setPending(true);
    setConflict(false);
    setError(null);
    void actions
      .saveWorkflow({
        expectedRevision: revision,
        discoveredWorkflowId: workflowId,
        discoveredName: workflowName,
      })
      .then((result) => {
        setPending(false);
        if (!result.ok) {
          if (result.error === "revision_conflict") setConflict(true);
          else setError(result.error);
          return;
        }
        setSaved(result.data);
        setRevision(typeof result.data.revision === "number" ? result.data.revision : null);
      });
  }
  const ghl = summary?.ghl;
  const proofs = ghlProofFromAttempts(attempts);

  return (
    <CardShell title="GoHighLevel" testId="card-ghl">
      <p className="text-sm text-slate-700">
        {ghl
          ? `Mode ${ghl.mode}. Location ${ghl.locationIdPresent ? "is stored" : "is not stored"}. Workflow id ${
              ghl.workflowIdPresent ? "is stored" : "is not stored"
            }. Trigger ${ghl.workflowTriggerMode ?? "unset"}.`
          : "GHL destination was not loaded."}
      </p>
      <p className="text-xs text-slate-500">
        {ghl
          ? `Notes ${ghl.notesEnabled ? "enabled" : "not enabled"}${ghl.notesContractVersion ? ` · ${ghl.notesContractVersion}` : ""}.`
          : "Notes state was not loaded."}{" "}
        An HTTP 200 is not proof a workflow completed.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <StatusMark label="HTTP accepted" state={proofs.http_accepted === "proven" ? "proven" : "unproven"} detail="Separate from contact, note, and enrollment." />
        <StatusMark label="Contact upserted" state={proofs.contact_upserted === "proven" ? "proven" : "unproven"} detail="HTTP acceptance does not upsert a contact." />
        <StatusMark label="Note persisted" state={proofs.note_persisted === "proven" ? "proven" : "unproven"} />
        <StatusMark label="Workflow enrolled" state={proofs.workflow_enrolled === "proven" ? "proven" : "unproven"} detail="Select Time Zone enrollment is its own proof." />
        <StatusMark label="Downstream executed" state={proofs.downstream_executed === "proven" ? "proven" : "unproven"} detail="Enrollment does not prove later workflow actions." />
      </div>
      {revision == null ? (
        <p className="text-xs text-amber-900" data-testid="profile-revision-unavailable">
          Select Time Zone save is unavailable. {MISSING_PROFILE_REVISION_READ}
        </p>
      ) : (
        <p className="text-xs text-slate-600">Select Time Zone save will send profile revision {revision}.</p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(null);
          void actions.loadWorkflows().then((result) => {
            setPending(false);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setMatch(result.data);
          });
        }}
      >
        {pending ? "Reading snapshot…" : "Discover Select Time Zone"}
      </Button>
      {match ? (
        <div className="space-y-2 text-sm">
          <p>
            Discovery {match.discoveryWired ? "read a stored snapshot" : "is not wired"}. Created workflow: no. Created custom field: no.
          </p>
          <p>Match: {match.workflowMatch}{match.workflowName ? ` · ${match.workflowName}` : ""}</p>
          {match.matches.length > 0 ? (
            <ul className="space-y-1">
              {match.matches.map((item) => (
                <li key={item.id}>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={revision == null || conflict || match.workflowMatch !== "unique" || item.id !== match.workflowId || pending}
                    onClick={() => saveSelection(item.id, item.name)}
                  >
                    Save {item.name}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {match.workflowMatch === "unique" && match.workflowId && match.workflowName && match.matches.length === 0 ? (
            <Button
              type="button"
              size="sm"
              disabled={revision == null || conflict || pending}
              onClick={() => saveSelection(match.workflowId!, match.workflowName!)}
            >
              Save Select Time Zone
            </Button>
          ) : null}
        </div>
      ) : null}
      {saved ? (
        <p className="text-sm text-slate-700">
          Workflow save persisted: {saved.persisted ? "yes" : "no"}. Delivery enabled: {String(saved.deliveryEnabled)}. Cutover:{" "}
          {String(saved.clientCutoverApproved)}. Trigger: {saved.workflowTriggerMode ?? "unchanged"}. The save response does
          not include the new profile revision, so another save is unavailable until that read exists.
        </p>
      ) : null}
      {conflict ? (
        <div className="space-y-2 text-sm" data-testid="revision-conflict" role="status">
          <p>{actionErrorCopy("revision_conflict")}</p>
          <p>Refresh and review the stored workflow. This screen will not send the save again.</p>
          <Link
            href={`/clients/${encodeURIComponent(clientAccountId)}/onboarding`}
            className="text-sky-700 hover:underline"
          >
            Review stored configuration
          </Link>
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-amber-800" role="status">
          {actionErrorCopy(error)}
        </p>
      ) : null}
    </CardShell>
  );
}
