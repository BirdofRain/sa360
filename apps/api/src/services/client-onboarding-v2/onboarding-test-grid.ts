/**
 * Exact-v3 emptiness proof for one isolated test worksheet.
 * A missing dimension, a failed formula read, or a grid past the cap is
 * unproven. Unproven is not empty.
 */

import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";

/** Row 5002 is inside this cap. A taller grid is refused instead of scanned partially. */
export const GOOGLE_ONLY_GRID_ROW_CAP = 5002;

/** Column AZ. Column AJ is inside this cap. A wider grid is refused. */
export const GOOGLE_ONLY_GRID_COLUMN_CAP = 52;

export type GridBounds = { rowCount: number; columnCount: number };

export type GridProof =
  | { state: "empty" }
  | { state: "occupied"; detail: string }
  | { state: "unproven"; detail: string };

export function columnLetters(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function gridBoundsFrom(rowCount: unknown, columnCount: unknown): GridBounds | null {
  if (typeof rowCount !== "number" || typeof columnCount !== "number") return null;
  if (!Number.isInteger(rowCount) || !Number.isInteger(columnCount)) return null;
  if (rowCount < 1 || columnCount < 1) return null;
  return { rowCount, columnCount };
}

export function gridRange(bounds: GridBounds): string {
  return `A1:${columnLetters(bounds.columnCount - 1)}${bounds.rowCount}`;
}

/**
 * `formulaValues` is a valueRenderOption=FORMULA read of the whole declared grid.
 * A formula is occupied even when its displayed value is blank.
 * The 35 header labels are the only cells allowed to be non-empty.
 */
export function classifyExactV3Grid(bounds: GridBounds | null, formulaValues: string[][] | null): GridProof {
  if (!bounds) {
    return { state: "unproven", detail: "worksheet grid dimensions were not read" };
  }
  if (bounds.rowCount > GOOGLE_ONLY_GRID_ROW_CAP || bounds.columnCount > GOOGLE_ONLY_GRID_COLUMN_CAP) {
    return {
      state: "unproven",
      detail: "worksheet grid exceeds the bounded read and was not treated as empty",
    };
  }
  if (!formulaValues) {
    return { state: "unproven", detail: "formula-aware body read failed and was not treated as empty" };
  }
  const header = [...COMPANY_SHEETS_V3_HEADER];
  if (header.length !== 35) {
    return { state: "unproven", detail: "the exact v3 header is not 35 columns" };
  }
  for (let rowIndex = 0; rowIndex < formulaValues.length; rowIndex += 1) {
    if (rowIndex + 1 > bounds.rowCount) {
      return { state: "unproven", detail: "formula read returned a row outside the declared grid" };
    }
    const row = formulaValues[rowIndex] ?? [];
    for (let column = 0; column < row.length; column += 1) {
      if (column + 1 > bounds.columnCount) {
        return { state: "unproven", detail: "formula read returned a column outside the declared grid" };
      }
      const cell = row[column] ?? "";
      if (rowIndex === 0 && column < header.length) {
        if (cell !== "" && cell !== header[column]) {
          return { state: "occupied", detail: "header is not the exact 35-cell v3 header" };
        }
        continue;
      }
      if (cell.trim() !== "" || cell.includes("=")) {
        return { state: "occupied", detail: `cell ${columnLetters(column)}${rowIndex + 1} is not empty` };
      }
    }
  }
  return { state: "empty" };
}

export function historicalDataRowsFromProof(proof: GridProof): "empty" | "has_rows" | "truncated" | "unproven" {
  if (proof.state === "empty") return "empty";
  if (proof.state === "occupied") return "has_rows";
  if (proof.detail.includes("exceeds")) return "truncated";
  return "unproven";
}
