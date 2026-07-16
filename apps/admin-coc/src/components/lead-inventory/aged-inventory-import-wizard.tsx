"use client";

import { useMemo, useState } from "react";

import { WarningBanner } from "@/components/dashboard/warning-banner";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { AGED_INVENTORY_IMPORT_COMMIT_CONFIRMATION } from "@sa360/shared";

type Mapping = Record<string, string>;

type PreviewResponse = {
  ok: true;
  writesPerformed: number;
  fileFingerprint: string;
  detectedHeaders: string[];
  proposedMapping: Mapping;
  mappingErrors: string[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    duplicate: number;
    alreadyExisting: number;
    ready: number;
    byState: Record<string, number>;
    byAgeBand: Record<string, number>;
  };
  rowPreviews: Array<{
    rowNumber: number;
    maskedExternalLeadId: string;
    classification: string;
    blockerCodes: string[];
    state: string | null;
    ageBandKey: string | null;
  }>;
  commitAllowed: boolean;
};

type CommitResponse = {
  ok: true;
  idempotentReplay: boolean;
  importedRows: number;
  pendingReviewRows: number;
  errorReportCsv: string | null;
  batch: { requestId: string; inventoryLotId: string | null };
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T;
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "request_failed");
  return data;
}

export function AgedInventoryImportWizard() {
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [mapping, setMapping] = useState<Mapping>({});
  const [dateFormat, setDateFormat] = useState<"" | "iso_date" | "mdy_slash">("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResponse | null>(null);
  const [lotKey, setLotKey] = useState("");
  const [lotDisplayName, setLotDisplayName] = useState("");
  const [nicheKey, setNicheKey] = useState("vet");
  const [exclusivityMode, setExclusivityMode] = useState<"exclusive" | "shared">("exclusive");
  const [operatorNote, setOperatorNote] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [requestId, setRequestId] = useState(() => `req-${Date.now()}`);
  const [busy, setBusy] = useState(false);

  const headers = useMemo(() => preview?.detectedHeaders ?? [], [preview]);

  async function onUpload(file: File) {
    setError(null);
    setCommitResult(null);
    setPreview(null);
    const text = await file.text();
    setFileName(file.name);
    setCsvText(text);
    setRequestId(`req-${Date.now()}`);
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<PreviewResponse>("/api/lead-inventory/imports/preview", {
        fileName,
        csvText,
        mapping: Object.keys(mapping).length ? mapping : undefined,
        dateFormat: dateFormat || undefined,
        defaultNicheKey: nicheKey,
      });
      setPreview(result);
      setMapping(result.proposedMapping);
    } catch (err) {
      setError(err instanceof Error ? err.message : "preview_failed");
    } finally {
      setBusy(false);
    }
  }

  async function runCommit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<CommitResponse>("/api/lead-inventory/imports/commit", {
        requestId,
        fileName,
        csvText,
        fileFingerprint: preview.fileFingerprint,
        mapping,
        dateFormat: dateFormat || undefined,
        lotKey,
        lotDisplayName,
        inventoryClass: "aged",
        exclusivityMode,
        nicheKey,
        sourceProvider: "manual_import",
        operatorNote,
        confirmation,
      });
      setCommitResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "commit_failed");
    } finally {
      setBusy(false);
    }
  }

  async function downloadErrorReport() {
    const result = await postJson<{ csvText: string; fileName: string }>(
      "/api/lead-inventory/imports/error-report",
      { fileName, csvText, mapping, dateFormat: dateFormat || undefined, defaultNicheKey: nicheKey }
    );
    const blob = new Blob([result.csvText], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <SectionPanel title="Import aged inventory">
      <div className="space-y-4 p-4">
        <WarningBanner tone="info" title="Preview performs no import">
          Upload and preview are read-only. Imported inventory remains pending review and is not
          automatically available for fulfillment.
        </WarningBanner>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              className="mt-1 block w-full text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onUpload(file);
              }}
            />
          </label>
          <label className="text-sm">
            Date format (if non-ISO)
            <select
              className="mt-1 w-full rounded border px-2 py-1"
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value as typeof dateFormat)}
            >
              <option value="">Auto (ISO only)</option>
              <option value="iso_date">ISO date</option>
              <option value="mdy_slash">MM/DD/YYYY</option>
            </select>
          </label>
        </div>

        {headers.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Column mapping</p>
            <div className="grid gap-2 md:grid-cols-2">
              {headers.map((header) => (
                <label key={header} className="text-xs">
                  {header}
                  <input
                    className="mt-1 w-full rounded border px-2 py-1 font-mono text-xs"
                    value={mapping[header] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [header]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={!csvText || busy}
          onClick={() => void runPreview()}
        >
          Preview import
        </button>

        {preview ? (
          <div className="space-y-2 rounded border p-3 text-sm">
            <p>Total: {preview.summary.total}</p>
            <p>Ready: {preview.summary.ready}</p>
            <p>Invalid: {preview.summary.invalid}</p>
            <p>Duplicates / existing: {preview.summary.duplicate}</p>
            <p>Already inventory: {preview.summary.alreadyExisting}</p>
            <p>Writes performed: {preview.writesPerformed}</p>
            <button type="button" className="text-xs underline" onClick={() => void downloadErrorReport()}>
              Download sanitized error report
            </button>
          </div>
        ) : null}

        {preview?.commitAllowed ? (
          <div className="space-y-3 rounded border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium">Commit lot metadata</p>
            <input
              className="w-full rounded border px-2 py-1 text-sm"
              placeholder="lot key"
              value={lotKey}
              onChange={(e) => setLotKey(e.target.value)}
            />
            <input
              className="w-full rounded border px-2 py-1 text-sm"
              placeholder="lot display name"
              value={lotDisplayName}
              onChange={(e) => setLotDisplayName(e.target.value)}
            />
            <input
              className="w-full rounded border px-2 py-1 text-sm"
              placeholder="niche key"
              value={nicheKey}
              onChange={(e) => setNicheKey(e.target.value)}
            />
            <select
              className="w-full rounded border px-2 py-1 text-sm"
              value={exclusivityMode}
              onChange={(e) => setExclusivityMode(e.target.value as "exclusive" | "shared")}
            >
              <option value="exclusive">exclusive</option>
              <option value="shared">shared</option>
            </select>
            <textarea
              className="w-full rounded border px-2 py-1 text-sm"
              placeholder="Operator note (required)"
              value={operatorNote}
              onChange={(e) => setOperatorNote(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Type exactly: {AGED_INVENTORY_IMPORT_COMMIT_CONFIRMATION}
            </p>
            <input
              className="w-full rounded border px-2 py-1 text-sm font-mono"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
            <button
              type="button"
              className="rounded bg-amber-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              disabled={busy || confirmation !== AGED_INVENTORY_IMPORT_COMMIT_CONFIRMATION}
              onClick={() => void runCommit()}
            >
              Commit import batch
            </button>
          </div>
        ) : null}

        {commitResult ? (
          <div className="rounded border border-green-200 bg-green-50 p-3 text-sm">
            <p>
              Committed {commitResult.importedRows} rows ({commitResult.pendingReviewRows} pending
              review). Idempotent replay: {String(commitResult.idempotentReplay)}
            </p>
            <p className="text-xs">Request ID: {commitResult.batch.requestId}</p>
            <p className="text-xs text-muted-foreground">
              On ambiguous response, inspect request ID and file fingerprint — do not resubmit.
            </p>
          </div>
        ) : null}

        {error ? (
          <WarningBanner tone="warn" title="Import flow error">
            {error}
          </WarningBanner>
        ) : null}
      </div>
    </SectionPanel>
  );
}
