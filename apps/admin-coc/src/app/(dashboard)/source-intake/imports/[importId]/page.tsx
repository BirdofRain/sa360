import Link from "next/link";
import { fetchBulkImportDetail } from "@/app/actions/bulk-imports";
import { BulkImportWizard } from "@/components/bulk-imports/bulk-import-wizard";
import { isBulkSourceImportsEnabled } from "@/lib/bulk-imports/config";

export default async function BulkImportDetailPage({
  params,
}: {
  params: Promise<{ importId: string }>;
}) {
  if (!isBulkSourceImportsEnabled()) {
    return <div className="p-6">Bulk imports are disabled.</div>;
  }

  const { importId } = await params;
  const detail = await fetchBulkImportDetail(importId).catch(() => null);
  if (!detail) {
    return (
      <div className="p-6">
        <p>Import batch not found.</p>
        <Link
          href="/source-intake/imports"
          className="mt-4 inline-flex rounded-md border px-3 py-2 text-sm"
        >
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Import batch</h1>
          <p className="text-sm text-muted-foreground font-mono">{importId}</p>
        </div>
        <Link
          href="/source-intake/imports"
          className="inline-flex rounded-md border px-3 py-2 text-sm"
        >
          All imports
        </Link>
      </div>
      <BulkImportWizard
        importId={importId}
        initial={detail as { batch: Record<string, unknown>; summary: Record<string, number> }}
      />
    </div>
  );
}
