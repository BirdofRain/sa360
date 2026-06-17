"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_BYTES = 10 * 1024 * 1024;

export type UploadBulkImportCsvInput = {
  fileName: string;
  csvText: string;
  importLabel?: string;
};

export type UploadBulkImportCsv = (
  input: UploadBulkImportCsvInput
) => Promise<{ batch: { id: string } }>;

type BulkImportNewFormViewProps = {
  uploadAction?: UploadBulkImportCsv;
  navigateToImport: (importId: string) => void;
};

export function BulkImportNewFormView({
  uploadAction,
  navigateToImport,
}: BulkImportNewFormViewProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importLabel, setImportLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function onFileSelect(file: File | null) {
    if (!file) return;
    setError(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Only CSV files are supported.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File exceeds 10MB limit.");
      return;
    }
    setSelectedFile(file);
  }

  async function resolveUploadAction(): Promise<UploadBulkImportCsv> {
    if (uploadAction) return uploadAction;
    const mod = await import("@/app/actions/bulk-imports");
    return mod.uploadBulkImportCsv;
  }

  async function onUpload() {
    if (!selectedFile || loading) return;
    setError(null);
    setLoading(true);
    try {
      const csvText = await selectedFile.text();
      const payload: UploadBulkImportCsvInput = {
        fileName: selectedFile.name,
        csvText,
      };
      const label = importLabel.trim();
      if (label) payload.importLabel = label;

      const upload = await resolveUploadAction();
      const result = await upload(payload);
      setSelectedFile(null);
      setImportLabel("");
      navigateToImport(result.batch.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4 rounded-lg border p-4">
      <div className="space-y-2">
        <Label htmlFor="import-label">Import label (optional)</Label>
        <Input
          id="import-label"
          value={importLabel}
          onChange={(e) => setImportLabel(e.target.value)}
          placeholder="GOAT Leads March 2026"
          disabled={loading}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="csv-file">CSV file</Label>
        <Input
          id="csv-file"
          type="file"
          accept=".csv,text/csv"
          disabled={loading}
          onChange={(e) => onFileSelect(e.target.files?.[0] ?? null)}
        />
        {selectedFile ? (
          <p className="text-xs text-muted-foreground">Selected: {selectedFile.name}</p>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button
        disabled={!selectedFile || loading}
        type="button"
        onClick={() => void onUpload()}
      >
        {loading ? "Uploading…" : "Upload CSV"}
      </Button>
    </div>
  );
}

export function BulkImportNewForm() {
  const router = useRouter();
  return (
    <BulkImportNewFormView
      navigateToImport={(importId) => router.push(`/source-intake/imports/${importId}`)}
    />
  );
}
