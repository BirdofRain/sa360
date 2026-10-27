"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { actionErrorCopy } from "@/lib/clients/onboarding/view";
import type {
  ColumnMapAssignment,
  ColumnMapRecord,
  OnboardingWorkspaceActions,
  SheetsTargetSave,
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
