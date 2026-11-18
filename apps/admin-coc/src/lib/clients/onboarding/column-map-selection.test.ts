import assert from "node:assert/strict";
import test from "node:test";

import type { ColumnMapRecord } from "./types";
import { splitColumnMaps } from "./column-map-selection";

function map(status: string, mapVersion: number, revision: number): ColumnMapRecord {
  return {
    id: `${status}-${mapVersion}-${revision}`,
    revision,
    mapVersion,
    status,
    sourceScope: "shared",
    baseSchemaVersion: "legacy_custom",
    spreadsheetId: "sheet",
    worksheetId: 15,
    worksheetTitle: "Campaign",
    headerFingerprint: "fp",
    headerSnapshot: ["Age/DOB"],
    assignments: [],
    issues: [],
    preview: [],
    targets: [],
    append: { behavior: "append", headerRow: "kept", existingRows: "kept", formulaColumns: "skipped" },
  };
}

test("a newer draft is the editor and an older draft does not hide the published map", () => {
  const published = map("published", 2, 4);
  const older = map("draft", 1, 1);
  const selected = splitColumnMaps([older, published], "sheet", 15);
  assert.equal(selected.editor?.id, published.id);
  assert.equal(selected.delivery?.id, published.id);
  assert.equal(selected.unpublished, null);

  const refreshed = map("draft", 3, 1);
  const next = splitColumnMaps([older, published, refreshed], "sheet", 15);
  assert.equal(next.editor?.id, refreshed.id);
  assert.equal(next.delivery?.id, published.id);
  assert.equal(next.unpublished?.id, refreshed.id);
});
