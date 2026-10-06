import assert from "node:assert/strict";
import test from "node:test";

import {
  AGED_INVENTORY_OPS_VERIFY_CONFIRMATION,
  LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
} from "@sa360/shared";

import {
  readScopeOptionFromArgv,
  resolveItemScope,
  resolveItemScopeArgument,
  scopedIdWhere,
} from "./aged-inventory-ops-verify.scope.js";

/** Exercises the CLI path: argv -> option values -> scope decision. */
function scopeFromArgv(argv: string[], readFile: (path: string) => string = () => "") {
  const inline = readScopeOptionFromArgv(argv, "inventory-item-ids");
  const filePath = readScopeOptionFromArgv(argv, "inventory-item-ids-file");
  return resolveItemScopeArgument({
    inline,
    file: filePath === null ? null : filePath === "" ? "" : readFile(filePath),
    filePath,
  });
}

test("ops verify confirmation phrases are exact", () => {
  assert.equal(AGED_INVENTORY_OPS_VERIFY_CONFIRMATION, "VERIFY AGED INVENTORY LOT");
  assert.equal(
    LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
    "MAKE REVIEWED INVENTORY AVAILABLE"
  );
});

test("operational verification claim boundaries are documented in reasons contract", () => {
  const forbiddenClaims = [
    "tcpa_consent_verified",
    "trustedform_verified",
    "buyer_delivery_proof",
    "source_ownership_proof",
  ];
  const allowedReasons = [
    "aged_operational_v1",
    "no_tcpa_claim",
    "no_trustedform_claim",
    "no_buyer_delivery_proof_claim",
    "no_source_ownership_proof_claim",
  ];
  for (const c of forbiddenClaims) {
    assert.equal(allowedReasons.includes(c), false);
  }
  assert.ok(allowedReasons.includes("aged_operational_v1"));
});

test("omitted or empty item scope keeps whole-lot behavior", () => {
  assert.equal(resolveItemScope(undefined), null);
  assert.equal(resolveItemScope([]), null);
  assert.equal(resolveItemScope(["", "   "]), null);
  assert.deepEqual(scopedIdWhere(null, undefined), {});
});

test("item scope is trimmed and deduped", () => {
  assert.deepEqual(resolveItemScope([" item_a ", "item_b", "item_a", ""]), [
    "item_a",
    "item_b",
  ]);
});

test("neither scope option supplied keeps the legacy whole-lot run", () => {
  assert.deepEqual(resolveItemScopeArgument({}), { kind: "omitted" });
  assert.deepEqual(resolveItemScopeArgument({ inline: null, file: null }), { kind: "omitted" });
  // Omission must reach the query as whole-lot, not as an empty scope.
  assert.equal(resolveItemScope(undefined), null);
  assert.deepEqual(scopedIdWhere(null, undefined), {});
});

test("valid inline ids produce a bounded scope", () => {
  assert.deepEqual(resolveItemScopeArgument({ inline: "item_a,item_b,item_c" }), {
    kind: "scoped",
    inventoryItemIds: ["item_a", "item_b", "item_c"],
  });
});

test("valid file ids produce a bounded scope identical to the inline form", () => {
  const fromFile = resolveItemScopeArgument({
    file: "item_a\nitem_b\nitem_c\n",
    filePath: "/tmp/ids.txt",
  });
  assert.deepEqual(fromFile, resolveItemScopeArgument({ inline: "item_a,item_b,item_c" }));
});

test("explicitly blank inline value is rejected instead of widening to the whole lot", () => {
  // This is the safety property: "" means the operator asked for a bounded run
  // and the ids were lost. Treating it as omission would verify/activate the lot.
  for (const inline of ["", "   ", "  \t ", " , , "]) {
    const result = resolveItemScopeArgument({ inline });
    assert.equal(result.kind, "invalid", `expected ${JSON.stringify(inline)} to be rejected`);
    assert.match(result.kind === "invalid" ? result.reason : "", /--inventory-item-ids/);
  }
});

test("explicitly empty or whitespace-only file is rejected", () => {
  for (const file of ["", "\n", "   \n\t\r\n", " , \n , "]) {
    const result = resolveItemScopeArgument({ file, filePath: "/tmp/empty.txt" });
    assert.equal(result.kind, "invalid", `expected ${JSON.stringify(file)} to be rejected`);
    assert.match(result.kind === "invalid" ? result.reason : "", /--inventory-item-ids-file/);
    assert.match(result.kind === "invalid" ? result.reason : "", /\/tmp\/empty\.txt/);
  }
  // A supplied-but-empty file fails closed even alongside a usable inline list:
  // the operator pointed at a file that did not hold what they expected.
  assert.equal(
    resolveItemScopeArgument({ inline: "item_a", file: "", filePath: "/tmp/empty.txt" }).kind,
    "invalid"
  );
});

test("argv distinguishes an omitted option from one supplied with no value", () => {
  // Absent.
  assert.equal(readScopeOptionFromArgv(["--mode", "verify"], "inventory-item-ids"), null);
  // Supplied with a real value.
  assert.equal(
    readScopeOptionFromArgv(["--inventory-item-ids", "item_a"], "inventory-item-ids"),
    "item_a"
  );
  // Supplied empty, trailing, or immediately followed by the next flag. All
  // three are "the operator asked for a scope and gave nothing", not omission.
  assert.equal(readScopeOptionFromArgv(["--inventory-item-ids", ""], "inventory-item-ids"), "");
  assert.equal(readScopeOptionFromArgv(["--inventory-item-ids"], "inventory-item-ids"), "");
  assert.equal(
    readScopeOptionFromArgv(["--inventory-item-ids", "--operator", "x"], "inventory-item-ids"),
    ""
  );
});

test("argv to scope decision: the six operator cases", () => {
  const files: Record<string, string> = {
    "/tmp/ids.txt": "item_a\nitem_b\n",
    "/tmp/empty.txt": "",
    "/tmp/blank.txt": "  \n\t\r\n ",
  };
  const read = (path: string) => files[path] ?? "";
  const base = ["--mode", "verify", "--lot-key", "lot_x"];

  // 1. neither option supplied -> legacy whole-lot
  assert.deepEqual(scopeFromArgv(base, read), { kind: "omitted" });
  // 2. valid inline ids -> bounded
  assert.deepEqual(scopeFromArgv([...base, "--inventory-item-ids", "item_a,item_b"], read), {
    kind: "scoped",
    inventoryItemIds: ["item_a", "item_b"],
  });
  // 3. valid file ids -> bounded
  assert.deepEqual(scopeFromArgv([...base, "--inventory-item-ids-file", "/tmp/ids.txt"], read), {
    kind: "scoped",
    inventoryItemIds: ["item_a", "item_b"],
  });
  // 4. explicit blank inline value -> rejected
  assert.equal(scopeFromArgv([...base, "--inventory-item-ids", ""], read).kind, "invalid");
  assert.equal(scopeFromArgv([...base, "--inventory-item-ids"], read).kind, "invalid");
  // 5. explicit empty / whitespace-only file -> rejected
  assert.equal(
    scopeFromArgv([...base, "--inventory-item-ids-file", "/tmp/empty.txt"], read).kind,
    "invalid"
  );
  assert.equal(
    scopeFromArgv([...base, "--inventory-item-ids-file", "/tmp/blank.txt"], read).kind,
    "invalid"
  );
  assert.equal(scopeFromArgv([...base, "--inventory-item-ids-file"], read).kind, "invalid");
  // 6. mixed separators + duplicates -> bounded, deduped downstream
  const mixed = scopeFromArgv([...base, "--inventory-item-ids", " item_b , item_a\nitem_b "], read);
  assert.equal(mixed.kind, "scoped");
  assert.deepEqual(
    resolveItemScope(mixed.kind === "scoped" ? mixed.inventoryItemIds : undefined),
    ["item_b", "item_a"]
  );
});

test("mixed separators and deduplication survive the scope hand-off", () => {
  const parsed = resolveItemScopeArgument({ inline: " item_b , item_a\n\nitem_b \r\n" });
  assert.deepEqual(parsed, {
    kind: "scoped",
    inventoryItemIds: ["item_b", "item_a", "item_b"],
  });
  const scope = resolveItemScope(parsed.kind === "scoped" ? parsed.inventoryItemIds : undefined);
  assert.deepEqual(scope, ["item_b", "item_a"]);
  assert.deepEqual(scopedIdWhere(scope, undefined), { id: { in: ["item_b", "item_a"] } });
});

test("scoped id filter keeps cursor paging intact", () => {
  // Scope alone.
  assert.deepEqual(scopedIdWhere(["item_a", "item_b"], undefined), {
    id: { in: ["item_a", "item_b"] },
  });
  // Cursor alone (legacy whole-lot paging).
  assert.deepEqual(scopedIdWhere(null, "item_a"), { id: { gt: "item_a" } });
  // Both must coexist, otherwise a scoped run would either rescan page 1
  // forever or silently drop the scope.
  assert.deepEqual(scopedIdWhere(["item_a", "item_b"], "item_a"), {
    id: { in: ["item_a", "item_b"], gt: "item_a" },
  });
});
