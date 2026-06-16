"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { uploadBulkImportCsv } from "@/app/actions/bulk-imports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_BYTES = 10 * 1024 * 1024;

export function BulkImportNewForm() {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [importLabel, setImportLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onFileChange(file: File | null) {
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
    setFileName(file.name);
    setLoading(true);
    try {
      const csvText = await file.text();
      const result = await uploadBulkImportCsv({
        fileName: file.name,
        csvText,
        importLabel: importLabel || undefined,
      });
      router.push(`/source-intake/imports/${result.batch.id}`);
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
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="csv-file">CSV file</Label>
        <Input
          id="csv-file"
          type="file"
          accept=".csv,text/csv"
          disabled={loading}
          onChange={(e) => void onFileChange(e.target.files?.[0] ?? null)}
        />
        {fileName ? <p className="text-xs text-muted-foreground">Selected: {fileName}</p> : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button disabled={loading} type="button">
        {loading ? "Uploading…" : "Upload CSV"}
      </Button>
    </div>
  );
}
