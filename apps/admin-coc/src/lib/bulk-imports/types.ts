import type { LucideIcon } from "lucide-react";
import { Upload } from "lucide-react";

export const bulkImportsNavItem = {
  href: "/source-intake/imports",
  label: "Bulk Imports",
  icon: Upload as LucideIcon,
};

export type BulkImportWizardStep =
  | "upload"
  | "map"
  | "destination"
  | "review"
  | "simulate"
  | "approve"
  | "monitor"
  | "results";

export const BULK_IMPORT_WIZARD_STEPS: BulkImportWizardStep[] = [
  "upload",
  "map",
  "destination",
  "review",
  "simulate",
  "approve",
  "monitor",
  "results",
];

export const BULK_IMPORT_APPROVE_PHRASE = "APPROVE BULK LEAD DELIVERY";
