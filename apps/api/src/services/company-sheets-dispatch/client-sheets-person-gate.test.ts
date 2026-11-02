import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifySheetsPerson,
  normalizeSheetsPhone,
  sheetsPersonIdentifiers,
  type SheetsPersonOwner,
} from "./client-sheets-person-gate.js";

const here = dirname(fileURLToPath(import.meta.url));

function owner(partial: Partial<SheetsPersonOwner> & Pick<SheetsPersonOwner, "kind" | "normalizedValue" | "ownerEventId">): SheetsPersonOwner {
  return {
    historicalImportKey: null,
    admissionId: partial.admissionId ?? "adm",
    origin: partial.origin ?? "live_reservation",
    status: partial.status ?? "reserved",
    jobId: partial.jobId ?? null,
    spreadsheetId: partial.spreadsheetId ?? null,
    worksheetId: partial.worksheetId ?? null,
    ...partial,
  };
}

test("phone and email formatting collapse to one identifier and names are not identifiers", () => {
  assert.equal(normalizeSheetsPhone("(555) 123-4567"), "+15551234567");
  assert.equal(normalizeSheetsPhone("5551234567"), "+15551234567");
  assert.equal(normalizeSheetsPhone("+1 555-123-4567"), "+15551234567");
  assert.equal(normalizeSheetsPhone("555"), null);
  const formatted = sheetsPersonIdentifiers({
    full_name: "Ada Lovelace",
    email: "Ada@Example.com",
    phone: "(555) 123-4567",
  });
  const compact = sheetsPersonIdentifiers({
    contact: { full_name: "Ada Lovelace", email: "ada@example.com", phone: "5551234567" },
  });
  assert.equal(formatted.phone, compact.phone);
  assert.equal(formatted.email, compact.email);
  assert.equal(formatted.fullName, "Ada Lovelace");
  assert.equal(sheetsPersonIdentifiers({ full_name: "Ada Lovelace" }).phone, null);
  assert.equal(sheetsPersonIdentifiers({ full_name: "Ada Lovelace" }).email, null);
});

test("classifySheetsPerson reserves, replays, blocks, and reviews without using a name", () => {
  assert.equal(
    classifySheetsPerson({
      sourceLeadEventId: "evt",
      phone: null,
      email: null,
      owners: [],
      historyIncomplete: false,
    }).reason,
    "no_normalized_phone_or_email"
  );
  assert.equal(
    classifySheetsPerson({
      sourceLeadEventId: "evt-b",
      phone: "+15551110002",
      email: "b@example.com",
      owners: [],
      historyIncomplete: false,
    }).action,
    "admit"
  );
  assert.equal(
    classifySheetsPerson({
      sourceLeadEventId: "evt-a",
      phone: "+15551110001",
      email: "a@example.com",
      owners: [
        owner({ kind: "phone", normalizedValue: "+15551110001", ownerEventId: "evt-a" }),
        owner({ kind: "email", normalizedValue: "a@example.com", ownerEventId: "evt-a" }),
      ],
      historyIncomplete: false,
    }).action,
    "replay"
  );
  const blocked = classifySheetsPerson({
    sourceLeadEventId: "evt-b",
    phone: "+15551110001",
    email: "fresh@example.com",
    owners: [owner({ kind: "phone", normalizedValue: "+15551110001", ownerEventId: "evt-a" })],
    historyIncomplete: false,
  });
  assert.equal(blocked.action, "block");
  assert.equal(blocked.reason, "normalized_identifier_already_admitted");
  const shared = classifySheetsPerson({
    sourceLeadEventId: "evt-c",
    phone: "+15551110001",
    email: "b@example.com",
    owners: [
      owner({ kind: "phone", normalizedValue: "+15551110001", ownerEventId: "evt-a" }),
      owner({ kind: "email", normalizedValue: "b@example.com", ownerEventId: "evt-b", admissionId: "other" }),
    ],
    historyIncomplete: false,
  });
  assert.equal(shared.action, "review");
  assert.equal(shared.reason, "shared_identifier_conflict");
  const delivery = classifySheetsPerson({
    sourceLeadEventId: "evt-c",
    phone: "+15551110009",
    email: null,
    owners: [
      owner({
        kind: "phone",
        normalizedValue: "+15551110009",
        ownerEventId: "evt-old",
        admissionId: null,
        origin: "sheets_delivery_job",
        jobId: "job-1",
        worksheetId: 4,
      }),
    ],
    historyIncomplete: false,
  });
  assert.equal(delivery.reason, "sheets_delivery_already_recorded");
  assert.equal(
    classifySheetsPerson({
      sourceLeadEventId: "evt-new",
      phone: "+15551110008",
      email: null,
      owners: [],
      historyIncomplete: true,
    }).reason,
    "delivery_history_incomplete"
  );
});

test("zap import and sheets person gate stay off the live zap and bypass writers", () => {
  const root = join(here, "../../..");
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name === "node_modules" || name === "dist") continue;
        walk(path);
        continue;
      }
      if (!name.endsWith(".ts")) continue;
      const text = readFileSync(path, "utf8");
      if (text.includes("importVerifiedZapSheetsBaseline")) hits.push(path);
    }
  };
  walk(join(root, "src"));
  walk(join(root, "../worker/src"));
  const allowed = hits.map((path) => path.slice(root.length));
  assert.deepEqual(allowed.sort(), [
    "/src/services/company-sheets-dispatch/client-sheets-person-gate.integration.test.ts",
    "/src/services/company-sheets-dispatch/client-sheets-person-gate.test.ts",
    "/src/services/company-sheets-dispatch/client-sheets-person-gate.ts",
  ]);

  const delivery = readFileSync(join(here, "../company-sheets-delivery/company-sheets-delivery.service.ts"), "utf8");
  const aged = delivery.slice(
    delivery.indexOf("export async function enqueueAuthorizedAgedReleaseSheetsDelivery"),
    delivery.indexOf("export async function enqueueCompanySheetsCanary")
  );
  const canary = delivery.slice(
    delivery.indexOf("export async function enqueueCompanySheetsCanary"),
    delivery.indexOf("export async function executeCompanySheetsDeliveryJob")
  );
  assert.equal(aged.includes("evaluateClientSheetsPersonGate"), false);
  assert.equal(canary.includes("evaluateClientSheetsPersonGate"), false);
  const captured = readFileSync(
    join(here, "../company-sheets-delivery/onboarding-captured-test-append.ts"),
    "utf8"
  );
  assert.equal(captured.includes("evaluateClientSheetsPersonGate"), false);
  const ghl = readFileSync(join(here, "../ghl-association-dispatch/ghl-association-dispatch.ts"), "utf8");
  assert.equal(ghl.includes("evaluateClientSheetsPersonGate"), false);
  assert.equal(ghl.includes("ClientSheetsPersonAdmission"), false);
});
