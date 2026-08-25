import Link from "next/link";
import type { ReactNode } from "react";

import { BulkImportListRetry } from "@/components/bulk-imports/bulk-import-list-retry";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import type {
  BulkImportListItem,
  PresentedBulkImportList,
} from "@/lib/bulk-imports/present-bulk-import-list";

export function BulkImportListPanel({
  list,
  renderActions,
  showRetry = true,
}: {
  list: PresentedBulkImportList;
  renderActions?: (item: BulkImportListItem) => ReactNode;
  showRetry?: boolean;
}) {
  if (list.availability === "unavailable") {
    return (
      <WarningBanner
        tone="err"
        title={list.title ?? "Bulk imports unavailable"}
        action={showRetry ? <BulkImportListRetry /> : undefined}
      >
        {list.message ??
          "Import history could not be loaded. Retry or check service health."}
      </WarningBanner>
    );
  }

  return (
    <div className="rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left">
            <th className="p-3">File</th>
            <th className="p-3">Status</th>
            <th className="p-3">Rows</th>
            <th className="p-3">Delivered</th>
            <th className="p-3">Created</th>
            <th className="p-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.availability === "empty" ? (
            <tr>
              <td colSpan={6} className="p-6 text-muted-foreground">
                No import batches yet.
              </td>
            </tr>
          ) : (
            list.items.map((item) => (
              <tr key={item.id} className="border-b">
                <td className="p-3">
                  <Link className="text-primary underline" href={`/source-intake/imports/${item.id}`}>
                    {item.fileName}
                  </Link>
                </td>
                <td className="p-3">{item.status}</td>
                <td className="p-3">
                  {item.validRows}/{item.totalRows}
                </td>
                <td className="p-3">{item.deliveredRows}</td>
                <td className="p-3">{new Date(item.createdAt).toLocaleString()}</td>
                <td className="p-3">{renderActions?.(item) ?? null}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
