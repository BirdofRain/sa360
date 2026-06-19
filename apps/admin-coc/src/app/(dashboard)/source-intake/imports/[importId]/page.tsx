import Link from "next/link";
import { fetchBulkImportDetail } from "@/app/actions/bulk-imports";
import { BulkImportDangerZone } from "@/components/bulk-imports/bulk-import-danger-zone";
import { BulkImportWizard } from "@/components/bulk-imports/bulk-import-wizard";
import { BulkImportWizardErrorBoundary } from "@/components/bulk-imports/bulk-import-wizard-error-boundary";
import { isBulkSourceImportsEnabled } from "@/lib/bulk-imports/config";

export default async function BulkImportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ importId: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  if (!isBulkSourceImportsEnabled()) {
    return <div className="p-6">Bulk imports are disabled.</div>;
  }

  const { importId } = await params;
  const { step } = await searchParams;
  const detailResult = await fetchBulkImportDetail(importId);
  if (!detailResult.ok) {
    return (
      <div className="p-6">
        <p>{detailResult.message}</p>
        <Link
          href="/source-intake/imports"
          className="mt-4 inline-flex rounded-md border px-3 py-2 text-sm"
        >
          Back
        </Link>
      </div>
    );
  }
  const detail = detailResult.data;

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
      <BulkImportWizardErrorBoundary importId={importId}>
        <BulkImportWizard
          importId={importId}
          requestedStep={step}
          initial={{
            batch: detail.batch as Record<string, unknown>,
            summary: detail.summary as Record<string, unknown>,
          }}
        />
      </BulkImportWizardErrorBoundary>
      <BulkImportDangerZone importId={importId} />
    </div>
  );
}
