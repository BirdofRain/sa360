import assert from "node:assert/strict";
import test from "node:test";

import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";

import { classifyExactV3Grid, GOOGLE_ONLY_GRID_COLUMN_CAP, GOOGLE_ONLY_GRID_ROW_CAP } from "./onboarding-test-grid.js";

const header = [...COMPANY_SHEETS_V3_HEADER];

test("a formula-aware grid read proves only an exact 35-cell header is empty", () => {
  assert.equal(classifyExactV3Grid({ rowCount: 1000, columnCount: 36 }, [header]).state, "empty");
  const row5002 = Array.from({ length: 5002 }, () => [] as string[]);
  row5002[0] = [...header];
  row5002[5001] = ["later-row"];
  assert.equal(classifyExactV3Grid({ rowCount: 5002, columnCount: 35 }, row5002).state, "occupied");
  const withAj = [header.concat(["hidden"])];
  assert.equal(classifyExactV3Grid({ rowCount: 10, columnCount: 36 }, withAj).state, "occupied");
  const formula = classifyExactV3Grid({ rowCount: 10, columnCount: 36 }, [header, ['=""']]);
  assert.equal(formula.state, "occupied");
  if (formula.state === "occupied") assert.match(formula.detail, /A2/);
  assert.equal(classifyExactV3Grid({ rowCount: 10, columnCount: 36 }, [header, ['=""']]).state, "occupied");
  assert.equal(classifyExactV3Grid({ rowCount: GOOGLE_ONLY_GRID_ROW_CAP + 1, columnCount: 35 }, [header]).state, "unproven");
  assert.equal(classifyExactV3Grid({ rowCount: 10, columnCount: GOOGLE_ONLY_GRID_COLUMN_CAP + 1 }, [header]).state, "unproven");
  assert.equal(classifyExactV3Grid(null, [header]).state, "unproven");
  assert.equal(classifyExactV3Grid({ rowCount: 10, columnCount: 35 }, null).state, "unproven");
});

test("a missing, blank, shifted, or incorrect header is not an empty worksheet", () => {
  const bounds = { rowCount: 1000, columnCount: 36 };
  for (const values of [
    [],
    [header.slice(0, 34)],
    [header.map((cell, index) => (index === 4 ? "" : cell))],
    [header.map((cell, index) => (index === 0 ? "Not Date" : cell))],
    [["", ...header.slice(0, 34)]],
    [header.map((cell) => `=${JSON.stringify(cell)}`)],
  ]) {
    const proof = classifyExactV3Grid(bounds, values);
    assert.notEqual(proof.state, "empty");
    assert.equal(proof.state, "occupied");
  }
  assert.equal(classifyExactV3Grid({ rowCount: 10, columnCount: 34 }, [header]).state, "occupied");
  const swapped = [header[1]!, header[0]!, ...header.slice(2)];
  const shifted = classifyExactV3Grid({ rowCount: 10, columnCount: 35 }, [swapped]);
  assert.equal(shifted.state, "occupied");
  if (shifted.state === "occupied") assert.match(shifted.detail, /exact 35-cell v3 header/);
});
