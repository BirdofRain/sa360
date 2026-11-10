"use client";

import { useEffect, useMemo, useState } from "react";

import {
  inspectTeamWorkspaceCompanySheetsStorageAction,
  loadTeamWorkspaceCompanySheetsAction,
  pageTeamWorkspaceCompanySheetsSpreadsheetsAction,
  readTeamWorkspaceCompanySheetsWorksheetsAction,
  type CompanySheetsDiscoveryActionResult,
} from "@/app/actions/team-workspace-company-sheets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  presentCompanySheetsDiscovery,
  type CompanySheetsDiscoverySnapshot,
} from "@/lib/team-workspace/company-sheets-discovery";

const BADGE = {
  on: "border-sky-200 bg-sky-50 text-sky-950",
  off: "border-slate-200 bg-white text-slate-600",
  warn: "border-amber-200 bg-amber-50 text-amber-950",
} as const;

export function CompanySheetsDiscoveryGuide({ clientAccountId }: { clientAccountId: string }) {
  const [snapshot, setSnapshot] = useState<CompanySheetsDiscoverySnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>("Loading the saved Company Sheets destination…");
  const [spreadsheetQuery, setSpreadsheetQuery] = useState("");
  const [worksheetQuery, setWorksheetQuery] = useState("");
  const [typedSpreadsheet, setTypedSpreadsheet] = useState("");
  const [selectedSpreadsheetId, setSelectedSpreadsheetId] = useState<string | null>(null);
  const [selectedWorksheetId, setSelectedWorksheetId] = useState<number | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);

  const view = snapshot
    ? presentCompanySheetsDiscovery({
        ...snapshot,
        selection: { spreadsheetId: typedSpreadsheet.trim() || selectedSpreadsheetId, worksheetId: selectedWorksheetId },
      })
    : null;

  function applyLoad(result: CompanySheetsDiscoveryActionResult) {
    if (result.snapshot) setSnapshot(result.snapshot);
    setNextPageToken(result.nextPageToken);
    setMessage(result.message);
  }

  useEffect(() => {
    let cancelled = false;
    setPending("Loading the saved Company Sheets destination…");
    void loadTeamWorkspaceCompanySheetsAction(clientAccountId)
      .then((result) => {
        if (!cancelled) applyLoad(result);
      })
      .catch(() => {
        if (!cancelled) setMessage("You do not have permission to read Company Sheets. Nothing was written.");
      })
      .finally(() => {
        if (!cancelled) setPending(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clientAccountId]);

  async function run(label: string, work: () => Promise<void>) {
    setPending(label);
    try {
      await work();
    } catch {
      setMessage("Company Sheets could not be read. Nothing was written.");
    } finally {
      setPending(null);
    }
  }

  const spreadsheets = useMemo(() => {
    const query = spreadsheetQuery.trim().toLowerCase();
    return (view?.spreadsheets ?? []).filter((item) => {
      if (!query) return true;
      return `${item.title} ${item.spreadsheetId}`.toLowerCase().includes(query);
    });
  }, [spreadsheetQuery, view?.spreadsheets]);
  const worksheets = useMemo(() => {
    const query = worksheetQuery.trim().toLowerCase();
    return (view?.worksheets ?? []).filter((item) => {
      if (!query) return true;
      return `${item.title} ${item.worksheetId}`.toLowerCase().includes(query);
    });
  }, [view?.worksheets, worksheetQuery]);

  const highlightedSpreadsheet = typedSpreadsheet.trim() || selectedSpreadsheetId;
  const saved = view?.savedDestination ?? null;
  const unsavedSpreadsheet = Boolean(highlightedSpreadsheet && highlightedSpreadsheet !== saved?.spreadsheetId);
  const unsavedWorksheet = selectedWorksheetId != null && saved != null && selectedWorksheetId !== saved.worksheetId;

  return (
    <section className="grid gap-4 rounded-md border border-slate-200 p-4" aria-label="Company Sheets discovery" aria-busy={pending != null}>
      <div className="grid gap-1">
        <h3 className="text-sm font-medium text-slate-950">Company Sheets discovery</h3>
        <p className="text-sm text-slate-600">
          Life Agent Launch owns the Google account. This guide reads the company connection, approved storage, the
          client folder, spreadsheets, and worksheet ids. Configured means a destination row is saved. Verified means
          this session confirmed company control and the bound campaign worksheet. Active means dispatch is already on.
          A readable link is not company control. Nothing here creates a file, saves a destination, or turns delivery on.
        </p>
      </div>
      {pending ? <p className="text-sm text-slate-600" role="status">{pending}</p> : null}
      {message ? <p className="text-sm text-amber-900" role="alert">{message}</p> : null}
      {view ? (
        <>
          <p className="text-sm text-slate-800" data-summary="company-sheets">{view.summary}</p>
          <div className="flex flex-wrap gap-2" aria-label="Company Sheets states">
            <StateBadge on={view.configured} label="Configured" />
            <StateBadge on={view.verified} label="Verified" />
            <StateBadge on={view.active} warn label="Active" />
          </div>
          <ol className="grid gap-2 sm:grid-cols-2">
            {view.steps.map((step, index) => (
              <li key={step.id} data-step={step.id} data-state={step.state} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                <span className="font-medium text-slate-950">{index + 1}. {step.label}</span>
                <span className="mt-1 block text-slate-600">{step.detail}</span>
              </li>
            ))}
          </ol>
          {view.active ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              An active destination is already saved. This page will not change that destination or its dispatch switches.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-slate-200 p-3 text-sm">
              <h4 className="font-medium text-slate-950">Saved destination</h4>
              {saved ? (
                <p className="mt-1 text-slate-700">
                  {saved.spreadsheetTitle ?? saved.spreadsheetId}. Worksheet {saved.worksheetId}
                  {saved.worksheetTitle ? ` (${saved.worksheetTitle})` : ""}. Previously recorded control: {saved.recordedControlBasis}.
                </p>
              ) : (
                <p className="mt-1 text-slate-600">No Company Sheets destination is saved.</p>
              )}
            </div>
            <div className="rounded-md border border-dashed border-slate-300 p-3 text-sm" data-unsaved={unsavedSpreadsheet || unsavedWorksheet ? "true" : "false"}>
              <h4 className="font-medium text-slate-950">Unsaved choice</h4>
              <p className="mt-1 text-slate-600">
                {highlightedSpreadsheet || selectedWorksheetId != null
                  ? `${unsavedSpreadsheet || unsavedWorksheet ? "Not saved. " : "Matches the saved destination. "}Spreadsheet ${highlightedSpreadsheet || "none"}. Worksheet ${selectedWorksheetId ?? "none"}.`
                  : "Nothing is highlighted. Highlighting a spreadsheet does not save it."}
              </p>
            </div>
          </div>
          <ul className="grid gap-2">
            {view.facts.map((fact) => (
              <li key={fact.id} data-fact={fact.id} data-state={fact.state} className="text-sm text-slate-700">
                <span className="font-medium text-slate-950">{fact.label}. </span>
                {fact.detail}
              </li>
            ))}
          </ul>
          <div>
            <h4 className="text-sm font-medium text-slate-950">Still blocked</h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
              {view.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending != null || !view.sheetsSetupAvailable}
              onClick={() => void run("Checking company storage…", async () => {
                applyLoad(await inspectTeamWorkspaceCompanySheetsStorageAction(clientAccountId));
              })}
            >
              Check storage
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending != null || !view.sheetsSetupAvailable || !highlightedSpreadsheet}
              onClick={() => void run("Reading worksheets…", async () => {
                const result = await readTeamWorkspaceCompanySheetsWorksheetsAction(clientAccountId, highlightedSpreadsheet ?? "");
                setMessage(result.message);
                if (result.read) {
                  setSnapshot((current) => current ? { ...current, worksheetRead: result.read, uncertain: result.uncertain } : current);
                }
              })}
            >
              Read worksheets
            </Button>
          </div>
          {!view.sheetsSetupAvailable ? (
            <p className="text-sm text-slate-600">Storage and worksheets stay unread while Company Sheets setup is turned off.</p>
          ) : null}
          <label className="grid gap-1 text-sm text-slate-800">
            Find a spreadsheet
            <Input value={spreadsheetQuery} onChange={(event) => setSpreadsheetQuery(event.target.value)} placeholder="Search by title or spreadsheet id" />
          </label>
          <label className="grid gap-1 text-sm text-slate-800">
            Check a spreadsheet id or link
            <Input value={typedSpreadsheet} onChange={(event) => setTypedSpreadsheet(event.target.value)} placeholder="Spreadsheet id or Google Sheets link" />
          </label>
          <p className="text-sm text-slate-600">Files in the recorded folder are not company-controlled until worksheets are read.</p>
          <ul className="grid gap-2">
            {spreadsheets.map((item) => (
              <li key={item.spreadsheetId}>
                <button
                  type="button"
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${highlightedSpreadsheet === item.spreadsheetId ? "border-sky-300 bg-sky-50" : "border-slate-200"}`}
                  aria-pressed={highlightedSpreadsheet === item.spreadsheetId}
                  onClick={() => {
                    setSelectedSpreadsheetId(item.spreadsheetId);
                    setTypedSpreadsheet("");
                  }}
                >
                  <span className="font-medium text-slate-950">{item.title}</span>
                  <span className="mt-1 block text-slate-600">
                    Id {item.spreadsheetId}. {item.saved ? "Saved destination." : "Not the saved destination."} {item.detail}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {view.candidateFolders.length > 0 ? (
            <div className="text-sm text-slate-700">
              <h4 className="font-medium text-slate-950">Folders seen under the approved parent</h4>
              <ul className="mt-1 list-disc pl-5">
                {view.candidateFolders.map((folder) => (
                  <li key={folder.folderId}>{folder.title} ({folder.folderId}). Not saved as this client’s folder.</li>
                ))}
              </ul>
            </div>
          ) : null}
          {nextPageToken ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending != null}
              onClick={() => void run("Loading more spreadsheets…", async () => {
                const result = await pageTeamWorkspaceCompanySheetsSpreadsheetsAction(clientAccountId, nextPageToken);
                setMessage(result.message);
                setNextPageToken(result.nextPageToken);
                if (result.ok) {
                  setSnapshot((current) => {
                    if (!current?.storage) return current;
                    const seen = new Set(current.storage.spreadsheets.map((item) => item.spreadsheetId));
                    return {
                      ...current,
                      storage: {
                        ...current.storage,
                        spreadsheets: [
                          ...current.storage.spreadsheets,
                          ...result.spreadsheets.filter((item) => !seen.has(item.spreadsheetId)),
                        ],
                        skipped: current.storage.skipped + result.skipped,
                      },
                    };
                  });
                }
              })}
            >
              Load more spreadsheets
            </Button>
          ) : null}
          <label className="grid gap-1 text-sm text-slate-800">
            Find a worksheet
            <Input value={worksheetQuery} onChange={(event) => setWorksheetQuery(event.target.value)} placeholder="Search by title or worksheet id" />
          </label>
          <ul className="grid gap-2">
            {worksheets.map((item) => (
              <li key={item.worksheetId}>
                <button
                  type="button"
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${selectedWorksheetId === item.worksheetId ? "border-sky-300 bg-sky-50" : "border-slate-200"}`}
                  aria-pressed={selectedWorksheetId === item.worksheetId}
                  onClick={() => setSelectedWorksheetId(item.worksheetId)}
                >
                  <span className="font-medium text-slate-950">{item.title}</span>
                  <span className="mt-1 block text-slate-600">
                    Id {item.worksheetId}. {item.grid ? "Grid tab." : "Not a grid tab."} {item.saved ? "Saved worksheet." : "Not the saved worksheet."}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-600">
            {view.googleAccountEmail ? `Company account ${view.googleAccountEmail}. ` : ""}
            Campaign contract: {view.campaignContract ? `${view.campaignContract.setupState}, worksheet ${view.campaignContract.worksheetId ?? "none"}` : "none"}.
            Column mapping: {view.columnMappingReadiness}. Delivery execution was not read and was not turned on.
          </p>
        </>
      ) : null}
    </section>
  );
}

function StateBadge({ on, label, warn = false }: { on: boolean; label: string; warn?: boolean }) {
  return (
    <span data-state-flag={label.toLowerCase()} data-on={on ? "true" : "false"} className={`rounded-full border px-2 py-0.5 text-xs ${on ? (warn ? BADGE.warn : BADGE.on) : BADGE.off}`}>
      {label}: {on ? "yes" : "no"}
    </span>
  );
}
