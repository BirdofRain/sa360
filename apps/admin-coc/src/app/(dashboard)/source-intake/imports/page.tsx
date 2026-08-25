import Link from "next/link";
import { fetchBulkImports } from "@/app/actions/bulk-imports";
import { BulkImportListActions } from "@/components/bulk-imports/bulk-import-list-actions";
import { BulkImportListPanel } from "@/components/bulk-imports/bulk-import-list-panel";
import { isBulkSourceImportsEnabled } from "@/lib/bulk-imports/config";
import { presentBulkImportList } from "@/lib/bulk-imports/present-bulk-import-list";

export default async function BulkImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  if (!isBulkSourceImportsEnabled()) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Bulk Imports</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Bulk source imports are disabled. Set NEXT_PUBLIC_SA360_BULK_SOURCE_IMPORTS_ENABLED=true.
        </p>
      </div>
    );
  }

  const result = await fetchBulkImports();
  const list = presentBulkImportList(result);
  const params = await searchParams;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Bulk Imports</h1>
          <p className="text-sm text-muted-foreground">
            Guarded CSV bulk lead imports — no automatic GHL delivery after upload.
          </p>
        </div>
        <Link
          href="/source-intake/imports/new"
          className="inline-flex rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
        >
          New import
        </Link>
      </div>

      {params.deleted === "1" ? (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Bulk import deleted successfully.
        </p>
      ) : null}

      <BulkImportListPanel
        list={list}
        renderActions={(item) => (
          <BulkImportListActions
            importId={item.id}
            fileName={item.fileName}
            status={item.status}
          />
        )}
      />
    </div>
  );
}
