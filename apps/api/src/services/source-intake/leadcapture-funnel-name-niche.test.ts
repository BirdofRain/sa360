import assert from "node:assert/strict";
import test from "node:test";

import { parseLeadCaptureFunnelNameNiche } from "./leadcapture-funnel-name-niche.js";

test("parses current LeadCapture naming patterns", () => {
  assert.deepEqual(parseLeadCaptureFunnelNameNiche("Life Insurance For Veterans"), {
    inventoryNicheKey: "vet_fex",
    recognizedNicheKey: "VET",
  });
  assert.deepEqual(parseLeadCaptureFunnelNameNiche("Life Insurance For Nurses"), {
    inventoryNicheKey: "nurse_life",
    recognizedNicheKey: "NURSE",
  });
  assert.deepEqual(parseLeadCaptureFunnelNameNiche("Self Employed Health"), {
    inventoryNicheKey: "health_insurance",
    recognizedNicheKey: "HEALTH",
  });
  assert.deepEqual(parseLeadCaptureFunnelNameNiche("Truckers"), {
    inventoryNicheKey: "trucker_life",
    recognizedNicheKey: "TRUCKER",
  });
  assert.deepEqual(parseLeadCaptureFunnelNameNiche("Truck Drivers"), {
    inventoryNicheKey: "trucker_life",
    recognizedNicheKey: "TRUCKER",
  });
  assert.deepEqual(parseLeadCaptureFunnelNameNiche("Mortgage Protection"), {
    inventoryNicheKey: "mortgage_protection",
    recognizedNicheKey: "MORTGAGE",
  });
  assert.deepEqual(parseLeadCaptureFunnelNameNiche("Final Expense"), {
    inventoryNicheKey: "final_expense",
    recognizedNicheKey: undefined,
  });
});

test("name parsing is case, whitespace, and hyphen tolerant", () => {
  assert.equal(
    parseLeadCaptureFunnelNameNiche("  LIFE  INSURANCE---FOR---NURSES- Alex Feuerstein ")
      ?.inventoryNicheKey,
    "nurse_life"
  );
  assert.equal(
    parseLeadCaptureFunnelNameNiche("life-insurance-for-veterans - Example Agent")
      ?.inventoryNicheKey,
    "vet_fex"
  );
});

test("does not guess from agent names or unknown labels", () => {
  assert.equal(parseLeadCaptureFunnelNameNiche("Matt Test Campaign 123"), undefined);
  assert.equal(parseLeadCaptureFunnelNameNiche("Alex Feuerstein"), undefined);
  assert.equal(parseLeadCaptureFunnelNameNiche("Andru Duranso"), undefined);
});
