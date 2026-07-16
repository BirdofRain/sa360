import type { AgedInventoryNormalizedRow } from "./aged-inventory-import.types.js";

export function buildAgedInventoryErrorReportCsv(rows: AgedInventoryNormalizedRow[]): string {
  const header = "row_number,masked_external_lead_id,classification,blocker_codes,correction_hint";
  const lines = rows
    .filter((row) => row.classification !== "ready")
    .map((row) => {
      const blockers = row.blockerCodes.join("|");
      const hint = (row.correctionHint ?? "").replace(/"/g, '""');
      return `${row.rowNumber},${row.maskedSourceLeadId},${row.classification},"${blockers}","${hint}"`;
    });
  return [header, ...lines].join("\n");
}
