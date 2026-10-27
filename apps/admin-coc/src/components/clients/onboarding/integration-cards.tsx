"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  actionErrorCopy,
  classificationCopy,
  ghlProofFromAttempts,
  schemaForClassification,
  sourceIdentityLabel,
  validDriveQuery,
} from "@/lib/clients/onboarding/view";
import type {
  CompanyConnectionIdentity,
  OnboardingDriveSearch,
  OnboardingFolderResolve,
  OnboardingSheetPreview,
  OnboardingSourceProof,
  OnboardingSpreadsheetListItem,
  OnboardingSummary,
  OnboardingTestAttempt,
  OnboardingWorkflowMatch,
  OnboardingWorkflowSave,
  OnboardingWorkspaceActions,
  OnboardingWorksheetPreview,
} from "@/lib/clients/onboarding/types";

import { StatusMark } from "./status-mark";

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
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={testId}>
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
}: {
  sources: OnboardingSourceProof[];
  evidenceTruncated: boolean;
}) {
  return (
    <CardShell title="LeadCapture" testId="card-leadcapture">
      {sources.length === 0 ? (
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

export function FacebookCard({ sources }: { sources: OnboardingSourceProof[] }) {
  return (
    <CardShell title="Facebook" testId="card-facebook">
      <p className="text-sm text-slate-600">
        Page and form association is capture evidence. Meta capture-only is complete when it is linked and observed.
        Routing and delivery stay separate and are not failures.
      </p>
      {sources.length === 0 ? (
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
  clientName,
  summary,
  connection,
  connectionError,
  actions,
  onViewWorksheet,
}: {
  clientName: string;
  summary: OnboardingSummary | null;
  connection: CompanyConnectionIdentity | null;
  connectionError: string | null;
  actions: OnboardingWorkspaceActions;
  onViewWorksheet: (worksheet: OnboardingWorksheetPreview, spreadsheetTitle: string) => void;
}) {
  const [scope, setScope] = useState<"approved_parent" | "client_folder">("approved_parent");
  const [query, setQuery] = useState(clientName);
  const [search, setSearch] = useState<OnboardingDriveSearch | null>(null);
  const [resolved, setResolved] = useState<OnboardingFolderResolve | null>(null);
  const [folderUrl, setFolderUrl] = useState("");
  const [spreadsheets, setSpreadsheets] = useState<OnboardingSpreadsheetListItem[] | null>(null);
  const [preview, setPreview] = useState<OnboardingSheetPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const states = summary?.sheets;

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
        <p className="mt-1 text-xs text-slate-500">Live delivery from this connection is off. OAuth tokens stay on the server.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <StatusMark label="Saved" state={states ? (states.destinationSaved ? "yes" : "no") : "unknown"} detail={states?.spreadsheetId ?? undefined} />
        <StatusMark
          label="Bound"
          state={summary ? (summary.gates.find((gate) => gate.id === "sheets_tab_explicitly_bound")?.satisfied ? "yes" : "no") : "unknown"}
          detail={states?.campaignTab ?? "No campaign worksheet title is stored"}
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
      {states?.destinationSaved ? (
        <p className="text-sm text-slate-700">
          Saved spreadsheet <span className="font-mono">{states.spreadsheetId}</span>
          {states.campaignTab ? <> · campaign tab {states.campaignTab}</> : null}
        </p>
      ) : (
        <p className="text-sm text-slate-600">No Sheets destination is saved yet. Search starts from the existing client name.</p>
      )}
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
              void run("search", () => actions.searchDrive({ scope, query }), setSearch);
            }}
          >
            <Label htmlFor="drive-query">Search existing client folders</Label>
            <div className="flex flex-wrap gap-2">
              <select
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                value={scope}
                onChange={(event) => setScope(event.target.value as "approved_parent" | "client_folder")}
                aria-label="Search scope"
              >
                <option value="approved_parent">Approved parent</option>
                <option value="client_folder">Linked client folder</option>
              </select>
              <Input id="drive-query" value={query} onChange={(event) => setQuery(event.target.value)} className="max-w-sm" />
              <Button type="submit" disabled={pending !== null}>
                {pending === "search" ? "Searching…" : "Search"}
              </Button>
            </div>
          </form>
          {search ? (
            <div className="space-y-2 text-sm">
              <p>Search saved nothing. Name match: {search.nameMatch}. Selected folder: none.</p>
              <DriveList title="Suggestions" items={search.suggestions} />
              <DriveList title="Matches" items={search.items} onPreview={previewItem} />
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
            <p className="text-sm text-slate-700">
              Resolved {resolved.folder.title} ({resolved.folder.folderId}). Saved: no. Basis: {resolved.folder.basis}.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void run("browse", () => actions.listSpreadsheets(), setSpreadsheets)}
          >
            {pending === "browse" ? "Loading spreadsheets…" : "Browse linked spreadsheets"}
          </Button>
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
      {preview ? <WorksheetPreview preview={preview} onView={onViewWorksheet} /> : null}
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
}

function DriveList({
  title,
  items,
  onPreview,
}: {
  title: string;
  items: OnboardingDriveSearch["items"];
  onPreview?: (id: string) => void;
}) {
  if (items.length === 0) return <p className="text-xs text-slate-500">{title}: none</p>;
  return (
    <div>
      <p className="text-xs font-medium text-slate-600">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 text-xs">
            <span>
              {item.title} · {item.kind}
              {item.reason ? ` · ${item.reason}` : ""}
            </span>
            {item.kind === "spreadsheet" && item.selectable && onPreview ? (
              <Button type="button" size="xs" variant="outline" onClick={() => onPreview(item.id)}>
                Preview
              </Button>
            ) : (
              <span>{item.selectable ? "Selectable" : "Not selectable"}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorksheetPreview({
  preview,
  onView,
}: {
  preview: OnboardingSheetPreview;
  onView: (worksheet: OnboardingWorksheetPreview, spreadsheetTitle: string) => void;
}) {
  return (
    <div className="space-y-3" data-testid="worksheet-preview">
      <p className="text-sm font-medium text-slate-900">
        {preview.spreadsheetTitle} · preview saved: no
        {preview.selection ? " · selection applied: no · bound: no" : ""}
      </p>
      {preview.recommendation ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          Recommended: {preview.recommendation.title} is an exact v3 header. It is not selected and it is not bound.
          {preview.recommendation.existingBinding ? " A campaign binding already points at this worksheet." : " Binding still requires an explicit action elsewhere."}
        </p>
      ) : null}
      <ul className="space-y-3">
        {preview.worksheets.map((sheet) => {
          const stats = sheet.classification === "stats_excluded";
          const schema = schemaForClassification(sheet.classification);
          return (
            <li key={sheet.worksheetId} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{sheet.title}</p>
                {stats ? (
                  <span className="text-xs text-slate-500">Preserved. Not a delivery target.</span>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={() => onView(sheet, preview.spreadsheetTitle)}>
                    View worksheet
                  </Button>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {classificationCopy(sheet.classification)}
                {schema ? ` Schema ${schema}.` : ""}
              </p>
              {sheet.historicalDataRows === "has_rows" ? (
                <p className="mt-1 text-xs text-slate-700">
                  Historical rows preserved ({sheet.historicalDataRowCount ?? "count stored"}). Preview does not rewrite them.
                </p>
              ) : null}
              {sheet.historicalDataRows === "truncated" ? (
                <p className="mt-1 text-xs text-amber-800">Row probe was truncated. This header check is incomplete.</p>
              ) : null}
              <p className="mt-2 text-xs text-slate-500">Exact header · {sheet.headerColumnCount} columns</p>
              <ol className="mt-1 max-h-28 overflow-auto font-mono text-[11px] leading-5 text-slate-800">
                {sheet.header.map((cell, index) => (
                  <li key={`${sheet.worksheetId}-${index}`}>
                    {index + 1}. {cell}
                  </li>
                ))}
              </ol>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function GhlCard({
  summary,
  actions,
  attempts,
}: {
  summary: OnboardingSummary | null;
  actions: OnboardingWorkspaceActions;
  attempts: OnboardingTestAttempt[];
}) {
  const [match, setMatch] = useState<OnboardingWorkflowMatch | null>(null);
  const [saved, setSaved] = useState<OnboardingWorkflowSave | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const ghl = summary?.ghl;
  const proofs = ghlProofFromAttempts(attempts);

  return (
    <CardShell title="GoHighLevel" testId="card-ghl">
      <p className="text-sm text-slate-700">
        Mode {ghl?.mode ?? "unknown"}. Location {ghl?.locationIdPresent ? "is stored" : "is not stored"}. Workflow id{" "}
        {ghl?.workflowIdPresent ? "is stored" : "is not stored"}. Trigger {ghl?.workflowTriggerMode ?? "unset"}.
      </p>
      <p className="text-xs text-slate-500">
        Notes {ghl?.notesEnabled ? "enabled" : "not enabled"}
        {ghl?.notesContractVersion ? ` · ${ghl.notesContractVersion}` : ""}. An HTTP 200 is not proof a workflow completed.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <StatusMark label="HTTP accepted" state={proofs.http_accepted === "proven" ? "proven" : "unproven"} detail="Separate from contact, note, and enrollment." />
        <StatusMark label="Contact upserted" state={proofs.contact_upserted === "proven" ? "proven" : "unproven"} detail="HTTP acceptance does not upsert a contact." />
        <StatusMark label="Note persisted" state={proofs.note_persisted === "proven" ? "proven" : "unproven"} />
        <StatusMark label="Workflow enrolled" state={proofs.workflow_enrolled === "proven" ? "proven" : "unproven"} detail="Select Time Zone enrollment is its own proof." />
        <StatusMark label="Downstream executed" state={proofs.downstream_executed === "proven" ? "proven" : "unproven"} detail="Enrollment does not prove later workflow actions." />
      </div>
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
                    disabled={match.workflowMatch !== "unique" || item.id !== match.workflowId}
                    onClick={() => {
                      setPending(true);
                      void actions
                        .saveWorkflow({
                          expectedRevision: 0,
                          discoveredWorkflowId: item.id,
                          discoveredName: item.name,
                        })
                        .then((result) => {
                          setPending(false);
                          if (!result.ok) {
                            setError(result.error);
                            return;
                          }
                          setSaved(result.data);
                        });
                    }}
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
              onClick={() => {
                setPending(true);
                void actions
                  .saveWorkflow({
                    expectedRevision: 0,
                    discoveredWorkflowId: match.workflowId!,
                    discoveredName: match.workflowName!,
                  })
                  .then((result) => {
                    setPending(false);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    setSaved(result.data);
                  });
              }}
            >
              Save Select Time Zone
            </Button>
          ) : null}
        </div>
      ) : null}
      {saved ? (
        <p className="text-sm text-slate-700">
          Workflow save persisted: {saved.persisted ? "yes" : "no"}. Delivery enabled: {String(saved.deliveryEnabled)}. Cutover:{" "}
          {String(saved.clientCutoverApproved)}. Trigger: {saved.workflowTriggerMode ?? "unchanged"}.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-amber-800" role="status">
          {actionErrorCopy(error)}
        </p>
      ) : null}
    </CardShell>
  );
}
