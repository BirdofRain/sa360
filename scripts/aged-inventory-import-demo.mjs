/**
 * Local demo script — not for commit with credentials.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildAgedInventoryImportPreview } from "../apps/api/src/services/aged-inventory-import/aged-inventory-import-preview.service.ts";
import { commitAgedInventoryImport } from "../apps/api/src/services/aged-inventory-import/aged-inventory-import-commit.service.ts";
import {
  buildAgedInventoryMappingFromSuggestions,
  fingerprintAgedInventoryCsv,
  suggestAgedInventoryMappings,
} from "../apps/api/src/services/aged-inventory-import/aged-inventory-import-mapping.service.ts";

const csvText = readFileSync(
  join(process.cwd(), "apps/api/src/fixtures/aged-inventory-import/demo-25-rows.csv"),
  "utf8"
);
const headers = csvText.trim().split("\n")[0].split(",");
const mapping = {
  ...buildAgedInventoryMappingFromSuggestions(suggestAgedInventoryMappings(headers)),
  external_lead_id: "source_lead_id",
  generated_date: "generated_at",
};
const requestId = `demo-aged-import-${Date.now()}`;
const fingerprint = fingerprintAgedInventoryCsv(csvText);

const preview = await buildAgedInventoryImportPreview({
  fileName: "demo-25-rows.csv",
  csvText,
  mapping,
  defaultNicheKey: "vet",
});
console.log("PREVIEW", JSON.stringify(preview, null, 2));

const commit1 = await commitAgedInventoryImport({
  requestId,
  fileName: "demo-25-rows.csv",
  csvText,
  fileFingerprint: fingerprint,
  mapping,
  lotKey: `lot_aged_demo_${Date.now()}`,
  lotDisplayName: "Demo Aged CSV Batch",
  inventoryClass: "aged",
  exclusivityMode: "exclusive",
  nicheKey: "vet",
  sourceProvider: "manual_import",
  operatorNote: "Local domain review demo import",
  confirmation: "IMPORT ONE AGED LEAD INVENTORY BATCH",
});
console.log("COMMIT1", JSON.stringify(commit1, null, 2));

const commit2 = await commitAgedInventoryImport({
  requestId,
  fileName: "demo-25-rows.csv",
  csvText,
  fileFingerprint: fingerprint,
  mapping,
  lotKey: `lot_aged_demo_replay`,
  lotDisplayName: "Should not create",
  inventoryClass: "aged",
  exclusivityMode: "exclusive",
  nicheKey: "vet",
  sourceProvider: "manual_import",
  operatorNote: "replay",
  confirmation: "IMPORT ONE AGED LEAD INVENTORY BATCH",
});
console.log("COMMIT2_REPLAY", JSON.stringify({ idempotentReplay: commit2.ok && commit2.idempotentReplay }, null, 2));
