"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { actionErrorCopy } from "@/lib/clients/onboarding/view";
import type {
  ColumnMapAssignment,
  ColumnMapRecord,
  OnboardingWorkspaceActions,
  SheetsTargetSave,
  StoredLeadColumnPreview,
  StoredLeadPreviewLead,
} from "@/lib/clients/onboarding/types";

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
}

function choiceValue(column: ColumnMapAssignment): string {
  if (column.decision !== "mapped" || !column.target) return "unmapped";
  return column.target.sourceField;
}

function withChoice(column: ColumnMapAssignment, choice: string, targets: ColumnMapRecord["targets"]): ColumnMapAssignment {
  if (!column.sheetHeader.trim() || choice === "unmapped") {
    return {
      ...column,
      target: null,
      decision: "unmapped",
      transform: "blank",
      explicit: true,
      code: column.sheetHeader.trim() ? (column.formula ? "formula_column_omitted" : null) : "blank_header",
    };
  }
  const target = targets.find((item) => item.sourceField === choice);
  if (!target) return column;
  return {
    ...column,
    target: { kind: "v3_column", header: target.header, sourceField: target.sourceField },
    decision: "mapped",
    transform: target.sourceField === "date_of_birth" ? "date_america_new_york" : "passthrough",
    explicit: true,
    code: column.formula ? "formula_column_omitted" : null,
  };
}

export function ColumnMapEditor({
  record,
  target,
  campaignDispatchEnabled,
  actions,
  onChange,
}: {
  record: ColumnMapRecord;
  target: SheetsTargetSave | null;
  campaignDispatchEnabled: boolean;
  actions: OnboardingWorkspaceActions;
  onChange: (record: ColumnMapRecord) => void;
}) {
  const [draft, setDraft] = useState(record);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const paused = campaignDispatchEnabled;
  const shown = draft.id === record.id ? draft : record;

  async function save(next: ColumnMapAssignment[]) {
    if (!actions.updateColumnMap || paused) return;
    setPending("save");
    setError(null);
    const saved = await actions.updateColumnMap(shown.id, { expectedRevision: shown.revision, assignments: next });
    setPending(null);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setDraft(saved.data);
    onChange(saved.data);
  }

  async function publish() {
    if (!actions.publishColumnMap || paused) return;
    setPending("publish");
    setError(null);
    const saved = await actions.publishColumnMap(shown.id, shown.revision);
    setPending(null);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setDraft(saved.data);
    onChange(saved.data);
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="column-map-editor">
      <p className="font-mono text-xs text-slate-800">
        Spreadsheet {shown.spreadsheetId} · worksheet gid {shown.worksheetId}
        {shown.worksheetTitle ? ` · ${shown.worksheetTitle}` : ""}
      </p>
      <p className="font-mono text-[11px] text-slate-600">Header fingerprint {shown.headerFingerprint}</p>
      <p className="text-xs text-slate-700">
        Map status {shown.status} · version {shown.mapVersion} · revision {shown.revision}. This is the saved column
        map, separate from the v1/v2/v3 template review.
      </p>
      {target ? (
        <p className="text-xs text-slate-700">
          Target saved. Schema {target.schemaVersion ?? "unchanged"} · {target.setupState}. Header rewritten: false.
          Readiness evidence invalidated: {target.readinessEvidenceInvalidated ? "yes" : "no"}. Campaign delivery stays
          paused.
        </p>
      ) : null}
      {paused ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-950" role="status">
          Pause campaign Sheets delivery before changing the target or the column map.
        </p>
      ) : null}
      <p className="text-xs text-slate-600">
        Appends add a new row only. The header row is not rewritten. Existing data rows are not rewritten. A column
        whose header or row-2 cell starts with = is omitted, so the existing formula stays. The new row leaves that
        cell empty. An unmapped or blank column is an
        empty cell on the new row only. Columns past the saved header are not written.
      </p>
      <ul className="space-y-2">
        {shown.assignments.map((column) => {
          const age = normalizeHeader(column.sheetHeader) === "age/dob";
          const blank = !column.sheetHeader.trim();
          const choices = age
            ? shown.targets.filter((item) => item.sourceField === "consumer_age" || item.sourceField === "date_of_birth")
            : shown.targets;
          return (
            <li key={`${shown.id}-${column.columnIndex}`} className="rounded-md bg-white px-2 py-2 text-xs">
              <p className="font-medium text-slate-900">
                {column.columnIndex + 1}. {column.sheetHeader.trim() ? column.sheetHeader : "(blank header)"}
              </p>
              {blank ? (
                <p className="text-slate-600">A blank header cannot be mapped. It stays an empty cell on the new row only.</p>
              ) : (
                <label className="mt-1 block text-slate-700" htmlFor={`map-${shown.id}-${column.columnIndex}`}>
                  Map {column.sheetHeader}
                  <select
                    id={`map-${shown.id}-${column.columnIndex}`}
                    className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2"
                    aria-label={`Map ${column.sheetHeader}`}
                    disabled={paused || pending !== null}
                    value={choiceValue(column)}
                    onChange={(event) => {
                      const next = shown.assignments.map((item) =>
                        item.columnIndex === column.columnIndex ? withChoice(item, event.target.value, shown.targets) : item
                      );
                      setDraft({ ...shown, assignments: next });
                    }}
                  >
                    <option value="unmapped">{age ? "Leave blank" : "Leave unmapped"}</option>
                    {choices.map((item) => (
                      <option key={item.sourceField} value={item.sourceField}>
                        {item.header}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {column.formula ? (
                <p className="mt-1 text-slate-600">Formula column. Appends skip it. Existing formulas stay.</p>
              ) : null}
              {column.decision === "ambiguous" ? (
                <p className="mt-1 text-amber-800">This column is unresolved. Choose a field or leave it unmapped.</p>
              ) : null}
              {!blank && !column.explicit && column.decision !== "ambiguous" ? (
                <p className="mt-1 text-slate-600">Suggestion only. Save the mapping to confirm it.</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {shown.issues.length > 0 ? (
        <ul className="space-y-1 text-xs text-amber-900" data-testid="column-map-issues">
          {shown.issues.map((issue) => (
            <li key={`${issue.columnIndex}-${issue.code}`}>{issue.message}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-emerald-800">Every column has an explicit decision.</p>
      )}
      <div>
        <p className="text-xs font-medium text-slate-700">Synthetic preview</p>
        <ol className="mt-1 font-mono text-[11px] text-slate-800">
          {shown.preview.map((cell, index) => (
            <li key={`${shown.id}-preview-${index}`}>
              {cell.sheetHeader || "(blank)"}: {cell.value || "(empty)"}
            </li>
          ))}
        </ol>
      </div>
      {actions.listStoredLeadsForColumnPreview && actions.previewStoredLeadColumnMap ? (
        <StoredLeadPreviewPanel
          record={shown}
          paused={paused || pending !== null}
          listLeads={actions.listStoredLeadsForColumnPreview}
          previewLead={actions.previewStoredLeadColumnMap}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={paused || pending !== null} onClick={() => void save(shown.assignments)}>
          {pending === "save" ? "Saving mapping…" : "Save mapping"}
        </Button>
        <Button type="button" size="sm" disabled={paused || pending !== null || shown.status === "published"} onClick={() => void publish()}>
          {pending === "publish" ? "Publishing…" : shown.status === "published" ? "Published" : "Publish mapping"}
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-amber-800" role="status">
          {actionErrorCopy(error)}
        </p>
      ) : null}
    </div>
  );
}

function StoredLeadPreviewPanel({
  record,
  paused,
  listLeads,
  previewLead,
}: {
  record: ColumnMapRecord;
  paused: boolean;
  listLeads: NonNullable<OnboardingWorkspaceActions["listStoredLeadsForColumnPreview"]>;
  previewLead: NonNullable<OnboardingWorkspaceActions["previewStoredLeadColumnMap"]>;
}) {
  const [query, setQuery] = useState("");
  const [leads, setLeads] = useState<StoredLeadPreviewLead[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<StoredLeadColumnPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function load(nextCursor: string | null, replace: boolean) {
    setPending("list");
    setError(null);
    const listed = await listLeads({ query, cursor: nextCursor });
    setPending(null);
    if (!listed.ok) {
      setError(listed.error);
      return;
    }
    setLeads((current) => (replace ? listed.data.leads : [...current, ...listed.data.leads]));
    setCursor(listed.data.nextCursor);
  }

  async function runPreview(basis: "draft" | "published") {
    if (!selectedId) return;
    setPending(basis);
    setError(null);
    const result = await previewLead({
      sourceLeadEventId: selectedId,
      spreadsheetId: record.spreadsheetId,
      worksheetId: record.worksheetId,
      mapId: record.id,
      basis,
      assignments: basis === "draft" ? record.assignments : undefined,
    });
    setPending(null);
    if (!result.ok) {
      setPreview(null);
      setError(result.error);
      return;
    }
    setPreview(result.data);
  }

  const stale = preview?.reasons.some((reason) => reason === "header_fingerprint_mismatch" || reason === "binding_absent") === true;

  return (
    <section className="space-y-2 rounded-md border border-sky-200 bg-white p-2" data-testid="stored-lead-column-preview">
      <p className="text-xs font-medium text-sky-950" role="status">
        Preview only. This does not append a row, send a test lead, call Google, or call GoHighLevel.
      </p>
      <p className="text-xs text-slate-700">
        Choose a stored lead for this client. Preview mapped row uses the dropdowns on this screen and does not save
        them. Preview published map uses the saved published map only.
      </p>
      <label className="block text-xs text-slate-700" htmlFor={`stored-lead-search-${record.id}`}>
        Search stored leads
        <input
          id={`stored-lead-search-${record.id}`}
          className="mt-1 h-8 w-full rounded-lg border border-slate-200 px-2"
          aria-label="Search stored leads"
          value={query}
          disabled={paused || pending !== null}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={paused || pending !== null} onClick={() => void load(null, true)}>
          {pending === "list" ? "Finding leads…" : "Find stored leads"}
        </Button>
        {cursor ? (
          <Button type="button" size="sm" variant="outline" disabled={paused || pending !== null} onClick={() => void load(cursor, false)}>
            Next stored leads
          </Button>
        ) : null}
      </div>
      {leads.length > 0 ? (
        <ul className="space-y-1">
          {leads.map((lead) => (
            <li key={lead.id}>
              <button
                type="button"
                className="w-full rounded-md border border-slate-200 px-2 py-1 text-left text-xs text-slate-800"
                aria-pressed={selectedId === lead.id}
                disabled={paused || pending !== null}
                onClick={() => {
                  setSelectedId(lead.id);
                  setPreview(null);
                }}
              >
                {lead.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={paused || pending !== null || !selectedId} onClick={() => void runPreview("draft")}>
          {pending === "draft" ? "Previewing draft…" : "Preview mapped row"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={paused || pending !== null || !selectedId} onClick={() => void runPreview("published")}>
          {pending === "published" ? "Previewing published map…" : "Preview published map"}
        </Button>
      </div>
      {preview ? (
        <div className="space-y-2">
          <p className="rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-xs text-sky-950" role="status">
            Preview only. Not delivery-ready. Google headers were not reread.
            {preview.basis === "draft" ? " Draft assignments were not saved." : " The published map was not changed."}
          </p>
          {stale ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-950" role="status">
              The stored header does not match this spreadsheet and worksheet binding. These values are not delivery-ready.
            </p>
          ) : null}
          <p className="text-xs text-slate-700">{preview.lead.label}</p>
          {preview.operatorDecisions.length > 0 ? (
            <ul className="space-y-1 text-xs text-amber-950">
              {preview.operatorDecisions.map((decision) => (
                <li key={decision.code}>Operator decision: {decision.message}</li>
              ))}
            </ul>
          ) : null}
          <table className="w-full text-left text-[11px] text-slate-800">
            <thead>
              <tr className="text-slate-600">
                <th className="py-1 pr-2">Column</th>
                <th className="py-1 pr-2">Header</th>
                <th className="py-1 pr-2">Source field</th>
                <th className="py-1 pr-2">Value</th>
                <th className="py-1">Warning</th>
              </tr>
            </thead>
            <tbody>
              {preview.columns.map((column) => {
                const missing = column.warnings.some((warning) => warning.code === "missing_source_value");
                return (
                  <tr key={`${column.position}-${column.sheetHeader}`} className={missing ? "bg-amber-50" : undefined} data-missing={missing ? "true" : "false"}>
                    <td className="py-1 pr-2 font-mono">
                      {column.columnLetter} · {column.position}
                    </td>
                    <td className="py-1 pr-2">{column.sheetHeader || "(blank)"}</td>
                    <td className="py-1 pr-2">{column.sourceField ?? "unmapped"}</td>
                    <td className="py-1 pr-2 font-mono">{column.formattedValue || "(blank)"}</td>
                    <td className="py-1">{column.warnings.map((warning) => warning.code).join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {error ? (
        <p className="text-xs text-amber-800" role="status">
          {actionErrorCopy(error)}
        </p>
      ) : null}
    </section>
  );
}
