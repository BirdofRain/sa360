import test from "node:test";
import assert from "node:assert/strict";
import {
  BULK_IMPORT_CANCEL_CONFIRMATION,
  BULK_IMPORT_DELETE_CONFIRMATION,
  BULK_IMPORT_RESET_CONFIRMATION,
} from "@sa360/shared";

test("lifecycle confirmation phrases are defined", () => {
  assert.equal(BULK_IMPORT_DELETE_CONFIRMATION, "DELETE BULK IMPORT");
  assert.equal(BULK_IMPORT_CANCEL_CONFIRMATION, "CANCEL BULK IMPORT");
  assert.equal(BULK_IMPORT_RESET_CONFIRMATION, "RESET BULK IMPORT");
});

test("delete rejects wrong confirmation phrase", async () => {
  const { deleteBulkImportBatch } = await import("./bulk-import-lifecycle.service.js");
  await assert.rejects(
    () => deleteBulkImportBatch("batch_test", "WRONG PHRASE"),
    /delete_confirmation_required/
  );
});

test("cancel rejects wrong confirmation phrase", async () => {
  const { cancelBulkImportBatch } = await import("./bulk-import-lifecycle.service.js");
  await assert.rejects(
    () => cancelBulkImportBatch("batch_test", "WRONG PHRASE"),
    /delete_confirmation_required/
  );
});

test("reset rejects wrong confirmation phrase", async () => {
  const { resetBulkImportBatch } = await import("./bulk-import-lifecycle.service.js");
  await assert.rejects(
    () => resetBulkImportBatch("batch_test", "mapping", "WRONG PHRASE"),
    /delete_confirmation_required/
  );
});
