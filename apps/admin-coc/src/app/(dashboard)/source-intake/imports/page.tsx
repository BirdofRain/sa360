import Link from "next/link";
import { fetchBulkImports } from "@/app/actions/bulk-imports";
import { isBulkSourceImportsEnabled } from "@/lib/bulk-imports/config";

export default async function BulkImportsPage() {
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

  const data = await fetchBulkImports().catch(() => ({ items: [] as Array<Record<string, unknown>> }));
  const items = data.items as Array<{
    id: string;
    fileName: string;
    status: string;
    totalRows: number;
    validRows: number;
    deliveredRows: number;
    createdAt: string;
  }>;

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

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              <th className="p-3">File</th>
              <th className="p-3">Status</th>
              <th className="p-3">Rows</th>
              <th className="p-3">Delivered</th>
              <th className="p-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-muted-foreground">
                  No import batches yet.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="p-3">
                    <Link className="text-primary underline" href={`/source-intake/imports/${item.id}`}>
                      {item.fileName}
                    </Link>
                  </td>
                  <td className="p-3">{item.status}</td>
                  <td className="p-3">{item.validRows}/{item.totalRows}</td>
                  <td className="p-3">{item.deliveredRows}</td>
                  <td className="p-3">{new Date(item.createdAt).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
