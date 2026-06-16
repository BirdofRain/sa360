import { BulkImportNewForm } from "@/components/bulk-imports/bulk-import-new-form";
import { isBulkSourceImportsEnabled } from "@/lib/bulk-imports/config";

export default function BulkImportNewPage() {
  if (!isBulkSourceImportsEnabled()) {
    return <div className="p-6">Bulk imports are disabled.</div>;
  }

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">New CSV import</h1>
      <p className="text-sm text-muted-foreground">
        Upload a CSV file. Rows enter Source Intake for review before any GHL delivery.
      </p>
      <BulkImportNewForm />
    </div>
  );
}
