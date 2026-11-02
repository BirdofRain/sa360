"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { sheetsColumnMapIssues } from "@sa360/shared";

import { Button } from "@/components/ui/button";
import { actionErrorCopy } from "@/lib/clients/onboarding/view";
import type {
  ColumnMapAssignment,
  ColumnMapDraftPreview,
  ColumnMapRecord,
  OnboardingWorkspaceActions,
} from "@/lib/clients/onboarding/types";

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
}

function choiceValue(column: ColumnMapAssignment): string {
  if (!column.sheetHeader.trim()) return "blank";
  if (column.formula && column.decision !== "mapped") return "skip_formula";
  if (column.decision === "ambiguous" || (column.decision !== "mapped" && !column.explicit)) return "";
  if (column.decision === "mapped" && column.target) return column.target.sourceField;
  if (column.explicit && column.decision === "unmapped") return "unmapped";
  return "";
}

function withChoice(column: ColumnMapAssignment, choice: string, targets: ColumnMapRecord["targets"]): ColumnMapAssignment {
  if (!column.sheetHeader.trim() || choice === "blank") {
    return {
      ...column,
      target: null,
      decision: "unmapped",
      transform: "blank",
      explicit: true,
      code: "blank_header",
    };
  }
  if (choice === "skip_formula") {
    return {
      ...column,
      target: null,
      decision: "unmapped",
      transform: "blank",
      explicit: true,
      code: "formula_column_omitted",
    };
  }
  if (choice === "" || choice === "unmapped") {
    return {
      ...column,
      target: null,
      decision: "unmapped",
      transform: "blank",
      explicit: choice === "unmapped",
      code: column.formula ? "formula_column_omitted" : null,
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

function dobAgeStatus(dobAge: NonNullable<ColumnMapDraftPreview["sheet"]>["dobAge"]): string {
  if (dobAge.conflict) return "Supplied age differs from DOB-derived age";
  if (dobAge.ageUnavailableReason === "no_valid_reference") {
    return "Missing reference date. Date of birth is stored and age was not derived.";
  }
  if (dobAge.ageUnavailableReason === "future_date_of_birth") {
    return "Date of birth is after the reference date. Age was not derived.";
  }
  if (dobAge.ageProvenance === "derived_from_date_of_birth") return "Age derived from DOB";
  if (dobAge.ageProvenance === "supplied") return "Supplied age";
  return "Missing DOB / reference information";
}

function reasonCopy(reason: ColumnMapDraftPreview["cells"][number]["reason"]): string {
  if (reason === "missing") return "Missing value";
  if (reason === "invalid") return "Invalid value";
  if (reason === "unmapped") return "Unmapped";
  if (reason === "blank_header") return "Blank header left empty";
  if (reason === "formula_omitted") return "Formula column omitted";
  if (reason === "ambiguous") return "Needs a choice";
  return "Shown";
}

function previewMatches(
  preview: ColumnMapDraftPreview,
  record: ColumnMapRecord,
  token: string,
  boundSchemaVersion: string | null
): boolean {
  return (
    preview.previewToken === token &&
    preview.mapId === record.id &&
    preview.revision === record.revision &&
    preview.spreadsheetId === record.spreadsheetId &&
    preview.worksheetId === record.worksheetId &&
    preview.headerFingerprint === record.headerFingerprint &&
    preview.schemaVersion === record.baseSchemaVersion &&
    preview.boundSchemaVersion === boundSchemaVersion &&
    preview.deliveryEnabled === false &&
    preview.sendsRow === false &&
    (!preview.available ||
      (preview.sheet !== null &&
        preview.sheet.header.length === preview.sheet.values.length &&
        preview.sheet.values.length === preview.cells.length))
  );
}

export function ColumnMapEditor({
  record,
  campaignDispatchEnabled,
  boundSchemaVersion = null,
  sourceEventId = null,
  actions,
  onChange,
}: {
  record: ColumnMapRecord;
  campaignDispatchEnabled: boolean;
  boundSchemaVersion?: string | null;
  sourceEventId?: string | null;
  actions: Pick<OnboardingWorkspaceActions, "saveAndPublishColumnMap" | "previewColumnMap">;
  onChange: (record: ColumnMapRecord) => void;
}) {
  const [draft, setDraft] = useState(record);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [preview, setPreview] = useState<ColumnMapDraftPreview | null>(null);
  const generation = useRef(0);
  const previewRequest = useRef(0);
  const paused = campaignDispatchEnabled;
  const shown = draft.id !== record.id ? record : record.revision > draft.revision ? record : draft;
  const blocking = sheetsColumnMapIssues(shown.assignments).filter((issue) => issue.code !== "formula_column_omitted");

  const clearPreview = useCallback(() => {
    generation.current += 1;
    previewRequest.current += 1;
    setPreview(null);
  }, []);

  useEffect(() => {
    clearPreview();
  }, [clearPreview, record.id, record.revision, record.headerFingerprint, record.spreadsheetId, record.worksheetId, record.baseSchemaVersion, boundSchemaVersion, sourceEventId]);

  function edit(next: ColumnMapAssignment[]) {
    clearPreview();
    setDraft({ ...shown, assignments: next });
  }

  async function saveAndPublish() {
    if (!actions.saveAndPublishColumnMap || paused || shown.status === "published") return;
    const token = generation.current;
    const revision = shown.revision;
    const assignments = shown.assignments;
    setPending("publish");
    setError(null);
    const saved = await actions.saveAndPublishColumnMap(shown.id, { expectedRevision: revision, assignments });
    if (token !== generation.current) {
      setPending((current) => (current === "publish" ? null : current));
      return;
    }
    setPending(null);
    if (!saved.ok || saved.published !== true || saved.deliveryEnabled !== false) {
      if (!saved.ok && saved.map && saved.map.id === shown.id) {
        setDraft(saved.map);
        onChange(saved.map);
      }
      setError(saved.ok ? "Publish did not return a draft that stayed unpublished." : saved.detail || actionErrorCopy(saved.error));
      return;
    }
    setDraft(saved.data);
    onChange(saved.data);
  }

  async function previewReceived() {
    if (!actions.previewColumnMap || paused) return;
    const requestId = previewRequest.current + 1;
    previewRequest.current = requestId;
    const token = `preview-${generation.current}-${requestId}-${shown.revision}`;
    const sentGeneration = generation.current;
    const revision = shown.revision;
    const assignments = shown.assignments;
    setPreview(null);
    setPending("preview");
    setError(null);
    const result = await actions.previewColumnMap(shown.id, { expectedRevision: revision, assignments, previewToken: token });
    if (sentGeneration !== generation.current || requestId !== previewRequest.current) {
      setPending((current) => (current === "preview" ? null : current));
      return;
    }
    setPending(null);
    if (!result.ok) {
      setPreview(null);
      setError(result.detail || actionErrorCopy(result.error));
      return;
    }
    if (
      !previewMatches(result.data, { ...shown, revision, assignments }, token, boundSchemaVersion) ||
      (result.data.available && result.data.sheet == null)
    ) {
      setPreview(null);
      return;
    }
    setPreview(result.data);
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="column-map-editor">
      <p className="font-mono text-xs text-slate-800">
        Spreadsheet {shown.spreadsheetId} · worksheet gid {shown.worksheetId}
        {shown.worksheetTitle ? ` · ${shown.worksheetTitle}` : ""}
      </p>
      <p className="font-mono text-[11px] text-slate-600">Header fingerprint {shown.headerFingerprint}</p>
      <p className="text-xs text-slate-700" data-testid="column-map-state">
        {shown.status === "published"
          ? `Published delivery configuration · version ${shown.mapVersion} · revision ${shown.revision}. Campaign delivery is a separate control and was not enabled here.`
          : `Draft revision ${shown.revision}. Published delivery configuration is unchanged.`}
      </p>
      {paused ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-950" role="status">
          Pause campaign Sheets delivery before changing the target or the column map.
        </p>
      ) : null}
      <p className="text-xs text-slate-600">
        Appends add a new row only. The header row is not rewritten. Existing data rows are not rewritten. A column
        whose header or row-2 cell starts with = is omitted, so the existing formula stays. The new row leaves that
        cell empty. An unmapped or blank column is an empty cell on the new row only. Columns past the saved header
        are not written.
      </p>
      <ul className="space-y-2">
        {shown.assignments.map((column) => {
          const age = normalizeHeader(column.sheetHeader) === "age/dob";
          const blank = !column.sheetHeader.trim();
          const formulaSkip = column.formula && column.decision !== "mapped";
          const choices = age
            ? shown.targets.filter((item) => item.sourceField === "consumer_age" || item.sourceField === "date_of_birth")
            : shown.targets;
          const label = blank ? "Blank header" : formulaSkip ? `Skip formula ${column.sheetHeader}` : `Map ${column.sheetHeader}`;
          return (
            <li key={`${shown.id}-${column.columnIndex}`} className="rounded-md bg-white px-2 py-2 text-xs">
              <p className="font-medium text-slate-900">
                {column.columnIndex + 1}. {column.sheetHeader.trim() ? column.sheetHeader : "(blank header)"}
              </p>
              <label className="mt-1 block text-slate-700" htmlFor={`map-${shown.id}-${column.columnIndex}`}>
                {label}
                <select
                  id={`map-${shown.id}-${column.columnIndex}`}
                  className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2"
                  aria-label={label}
                  disabled={paused || shown.status === "published"}
                  value={choiceValue(column)}
                  onChange={(event) => {
                    const next = shown.assignments.map((item) =>
                      item.columnIndex === column.columnIndex ? withChoice(item, event.target.value, shown.targets) : item
                    );
                    edit(next);
                  }}
                >
                  {blank ? <option value="blank">Leave blank</option> : null}
                  {formulaSkip ? <option value="skip_formula">Skip formula</option> : null}
                  {blank || formulaSkip ? null : <option value="">{age ? "Choose Age, DOB, or leave blank" : "Choose a field or leave unmapped"}</option>}
                  {blank || formulaSkip ? null : <option value="unmapped">{age ? "Leave blank" : "Leave unmapped"}</option>}
                  {blank || formulaSkip
                    ? null
                    : choices.map((item) => (
                        <option key={item.sourceField} value={item.sourceField}>
                          {item.header}
                        </option>
                      ))}
                </select>
              </label>
              {blank ? <p className="mt-1 text-slate-600">A blank header cannot be mapped. It stays an empty cell on the new row only.</p> : null}
              {column.formula ? <p className="mt-1 text-slate-600">Formula column. Appends skip it. Existing formulas stay.</p> : null}
              {column.decision === "ambiguous" ? (
                <p className="mt-1 text-amber-800">This column is unresolved. Choose a field or leave it unmapped.</p>
              ) : null}
              {!blank && !column.formula && !column.explicit && column.decision === "mapped" ? (
                <p className="mt-1 text-slate-600">Suggestion only. Save & publish confirms this visible selection.</p>
              ) : null}
              {!blank && !column.formula && !column.explicit && column.decision === "unmapped" ? (
                <p className="mt-1 text-amber-800">This column is unresolved. Choose a field or leave it unmapped.</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {blocking.length > 0 ? (
        <ul className="space-y-1 text-xs text-amber-900" data-testid="column-map-issues">
          {blocking.map((issue) => (
            <li key={`${issue.columnIndex}-${issue.code}`}>{issue.message}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-emerald-800">Every column has an explicit decision.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={paused || pending !== null || shown.status === "published" || !actions.saveAndPublishColumnMap} onClick={() => void saveAndPublish()}>
          {pending === "publish" ? "Saving and publishing…" : shown.status === "published" ? "Published" : "Save & publish mapping"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={paused || pending !== null || !actions.previewColumnMap} onClick={() => void previewReceived()}>
          {pending === "preview" ? "Loading received submission…" : "Preview received submission"}
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-amber-800" role="alert">
          {error}
        </p>
      ) : null}
      {preview ? (
        <div data-testid="column-map-received-preview" className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
          <p className="text-xs font-medium text-slate-900" data-testid="column-map-preview-source">
            {preview.configuration === "draft"
              ? "This preview uses the unpublished draft."
              : "This preview uses the published map that delivery uses."}
          </p>
          <p className="text-xs text-slate-600">
            {preview.configuration === "draft"
              ? "Published delivery configuration is unchanged. No row is sent and delivery stays off."
              : "This read uses the published map. It does not send a row and does not enable delivery."}
          </p>
          {preview.available && preview.sheet ? (
            <>
              <p className="font-mono text-[11px] text-slate-700">
                Received submission {preview.sourceLeadEventId} · {preview.receivedAt}
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-1 pr-3 font-medium">Header</th>
                      <th className="py-1 pr-3 font-medium">Received answer</th>
                      <th className="py-1 pr-3 font-medium">Canonical field</th>
                      <th className="py-1 pr-3 font-medium">Output value</th>
                      <th className="py-1 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sheet.header.map((header, index) => {
                      const cell = preview.cells[index];
                      const output = preview.sheet?.values[index] ?? "";
                      return (
                        <tr key={`${preview.previewToken}-${index}`} className="border-b border-slate-100">
                          <td className="py-1 pr-3">{header.trim() ? header : "(blank header)"}</td>
                          <td className="py-1 pr-3">{cell?.receivedAnswer || "(blank)"}</td>
                          <td className="py-1 pr-3">{cell?.canonicalField || "(none)"}</td>
                          <td className="py-1 pr-3">{output || "(empty)"}</td>
                          <td className="py-1">{reasonCopy(cell?.reason ?? null)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div data-testid="column-map-dob-age" className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800">
                <p className="font-medium text-slate-900">{dobAgeStatus(preview.sheet.dobAge)}</p>
                <p>Date of birth {preview.sheet.dobAge.dateOfBirth || "(blank)"}</p>
                <p>Derived age {preview.sheet.dobAge.derivedAge || "(blank)"}</p>
                <p>Reference date {preview.sheet.dobAge.referenceDate || "(blank)"}</p>
                <p className="font-mono text-[11px] text-slate-600">{preview.sheet.dobAge.referenceRule}</p>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-700">{preview.emptyReason}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
