/**
 * Warnings for the current column-map draft.
 * Publish still enforces the same decisions on the server. The editor uses
 * this so the visible list follows the operator's current choices.
 */

export type SheetsColumnMapIssueInput = {
  columnIndex: number;
  sheetHeader: string;
  decision: "mapped" | "unmapped" | "ambiguous";
  explicit: boolean;
  formula: boolean;
  code: string | null;
};

export type SheetsColumnMapIssue = {
  columnIndex: number;
  sheetHeader: string;
  code: string;
  message: string;
};

const REQUIRED_NORMALIZED = new Set([
  "phone",
  "phone number",
  "email",
  "e-mail",
  "client name",
  "full name",
  "name",
]);

function normalizeSheetHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
}

function issue(column: SheetsColumnMapIssueInput, code: string, message: string): SheetsColumnMapIssue {
  return { columnIndex: column.columnIndex, sheetHeader: column.sheetHeader, code, message };
}

export function sheetsColumnMapIssues(columns: readonly SheetsColumnMapIssueInput[]): SheetsColumnMapIssue[] {
  const issues: SheetsColumnMapIssue[] = [];
  for (const column of columns) {
    if (column.code === "blank_header" && !column.explicit) {
      issues.push(issue(column, "blank_header", "This header is blank. Leave it unmapped. It is not a lead field."));
    } else if (column.code === "duplicate_header" || (column.decision === "ambiguous" && column.code === "duplicate_header")) {
      issues.push(
        issue(
          column,
          "duplicate_header",
          "This header is duplicated. Map one column explicitly and leave the other unmapped, or choose different fields."
        )
      );
    } else if (column.code === "ambiguous_age_or_dob" || (column.decision === "ambiguous" && normalizeSheetHeader(column.sheetHeader) === "age/dob")) {
      issues.push(
        issue(column, "ambiguous_age_or_dob", "Age/DOB is ambiguous. Choose Age, DOB, or leave it blank. Age is not calculated from DOB.")
      );
    } else if (!column.explicit) {
      issues.push(issue(column, "mapping_unresolved", "Confirm this suggestion or mark the column unmapped."));
    } else if (column.decision === "ambiguous") {
      issues.push(issue(column, column.code ?? "mapping_unresolved", "This column is still ambiguous."));
    }
    if (column.formula) {
      issues.push(
        issue(
          column,
          "formula_column_omitted",
          "This column has a formula. Appends skip it so the formula and existing rows stay intact."
        )
      );
    }
    if (column.explicit && column.decision === "unmapped" && REQUIRED_NORMALIZED.has(normalizeSheetHeader(column.sheetHeader))) {
      issues.push(issue(column, "required_field_unmapped", "Phone, email, and name columns must be mapped before publish."));
    }
  }
  return issues;
}
