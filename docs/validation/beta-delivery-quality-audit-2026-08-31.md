# SA360 PPL beta delivery-quality audit

**Date:** 2026-08-31  
**Scope:** READ / VALIDATION ONLY against `origin/master` (`6fab3f5`, “Final customer-journey regression after #96 and #98 (#99)”).  
**Not done:** deploy, production writes, PPL/LF2/NextGen `inventory_only`/GHL activation, export-behavior changes, product implementation, replacement/refund architecture.

This audit answers one question: can the spreadsheet produced by the current SA360 PPL fulfillment path be handed **directly** to the first controlled beta customer, measured against the Alex delivery-rehearsal cleanup standard — not a generic CSV review.

---

## 1. Verdict

**READY WITH OPERATOR CLEANUP**

The path is safe enough for a **controlled** first beta if Alex remains in the loop and applies the rehearsal cleanup **before** the customer receives a file. It is **not** customer-ready as a direct handoff.

Why not `CUSTOMER READY`:

- New Vet/Trucker packages use `buyer_csv_v3` with internal snake_case headers. Column order and labels do not match the rehearsal file (`Date Generated` far left, `Lead Type` in column B, `Veteran`).
- Missing consumer age, one-character names, and multi-part names are **exported**, not removed.
- Blank `zip` and `coverage_amount` columns stay on the file even when every cell is empty.
- Rows are **oldest-first**, not newest-first.
- There is no reserved overage. Cleanup that drops rows shrinks delivered count below the commercial order unless Alex places a second order or over-requests.

Why not `NOT READY`:

- Generated ≠ Released is enforced. The customer cannot list or download an unreleased package.
- Requested / selected / exported / released row counts agree when Alex does not edit the file after commit.
- Same-buyer redelivery and in-batch identity duplicates are blocked **after** `markSpreadsheetDelivered`.
- Forbidden internal columns (allocation ids, supplier, campaign, DOB, cost) are allowlisted out of the CSV.
- The designed beta path is already operator-mediated (FOWB preview → commit → internal download → Approve & Release).

**Alex guardrail (do this on every first-beta order):** treat the generated CSV as an operator work file, not the customer file. Clean a local copy to the rehearsal standard, send that copy, and do not point the customer at portal download unless that portal file has also been accepted as-is. Approve & Release records identities and unlocks the **immutable generated package**, not Alex’s cleaned copy.

---

## 2. Rule matrix

Classification:

- **automatic today** — code enforces it on the PPL select/export/release path
- **partially automatic** — related gate exists, but not this delivery rule
- **manual** — operator must do it after download
- **unsupported** — no implementation on this path
- **ambiguous** — evidence conflicts or the rule is not specified in code

| Requirement | Current behavior | Automatic / manual | Evidence | Beta risk |
| --- | --- | --- | --- | --- |
| 1. Remove any lead without an age | Consumer `age` is optional sales-context. Blanks never fail export. Selection **must not** read `consumer_age`. Inventory “age” is `generatedAt` days (commerce bucket), a different field. | **unsupported** on PPL select/export; **manual** cleanup | `buyer-lead-fields.ts` (`readBuyerCsvV3ZipAndAge`); `buyer-csv-v3.contract.test.ts` (“never derives consumer age”, “serializes missing optional v3 fields as blank”); `eligibility-optional-fields.contract.test.ts`; journey evidence CSV rows have empty `age` | **High.** Rehearsal required dropping no-age rows. Current fixtures and many campaign items export blank `age`. Aged-bulk intake *can* store `lead_details.consumer_age` when the master AGE column parses (`aged-inventory-bulk-consumer-age.ts`), but PPL will still export a blank-age row if that field is missing. |
| 2. Remove one-character first names | Export writes `first_name` as stored. No length check in selection or export. | **unsupported** on PPL path; **partially automatic** only at aged-bulk intake (rejects a name that cannot split into two tokens). `"A Smith"` still imports. | `extractBuyerCsvFields` in `buyer-csv-export.service.ts`; `splitName` in `aged-inventory-bulk-normalize.ts` | **High.** One-character first names reach the customer file. |
| 3. Remove one-character last names | Same as first names. `"John S"` imports and exports. | **unsupported** on PPL path | Same extractors; `splitName` keeps `parts.slice(1).join(" ")` | **High.** |
| 4. Remove names with spaces / multi-part names | Export preserves spaces and commas (`"Ada, ""Countess"""`, `"O'Brien, PhD"`). Aged-bulk `splitName` puts extra tokens into last name (`"Mary Ann Smith"` → first `Mary`, last `Ann Smith`). | **unsupported** as a delivery filter; **ambiguous** policy at intake (multi-part last names are stored, not dropped) | `buyer-csv-export.service.test.ts` escape test; `aged-inventory-bulk-normalize.ts` `splitName` | **High.** Current delivery policy is not encoded. Multi-part last names will appear. |
| 5. Remove blank ZIP column when ZIP unavailable | `buyer_csv_v3` **always** includes `zip` after `state`. Empty cells, column stays. `buyer_csv_v2` (nurse/mortgage/solar) has no zip column at all. | **unsupported** (v3 keeps the column); v2 is a different schema, not this rule | `BUYER_CSV_V3_BASE_COLUMNS`; journey evidence header and `NC,,,2025-07-24` blank zip/age | **Medium.** Customer sees an empty ZIP column on Vet/Trucker files. |
| 6. Lead date far-left, renamed `Date Generated` | Column is `lead_date`, 8th on v3 / 6th on v2. Value is `LeadInventoryItem.generatedAt` as UTC date-only (`YYYY-MM-DD`). | **unsupported** | `leadDateOnlyUtc`; `extractBuyerCsvFields`; journey header | **Medium.** Internal label and position leak. Date itself is the correct source timestamp. |
| 7. Niche to column B, renamed `Lead Type` | Column is `niche`, after `lead_date`. Value is `order.nicheKey.trim()` (e.g. `vet`). | **unsupported** | `extractBuyerCsvFields` `niche: input.nicheKey.trim()`; journey rows end `...,vet,,,,,` | **High.** Internal key in a mid-file column. |
| 8. Internal `Vet` → customer `Veteran` (prefer display name) | CSV writes the niche **key**. Filename uppercases the key (`VET`). FOWB and export context show `order.nicheKey`. No display-name map on export. | **unsupported** | `buyer-csv-filename.ts` (`nicheKey.trim().toUpperCase()`); journey filename `..._VET_NC_...`; `PplExportContextPanel` | **High.** Customer-facing `vet` / `VET`. |
| 9. Remove Coverage Amount when no coverage data | `coverage_amount` is always on v2/v3. Blank cells allowed. FOWB shows `optionalFieldCoverage` counts; export does not drop the column. | **unsupported** | `BUYER_CSV_BASE_COLUMNS`; `summarizeOptionalFieldCoverage`; journey rows with empty coverage | **Medium.** Empty coverage column on the customer file. |
| 10. Sort newest / freshest first | Selection scans `orderBy: [{ generatedAt: "asc" }, { id: "asc" }]` (oldest first). Export serializes `orderBy: [{ proposedAt: "asc" }, { id: "asc" }]`. Journey released CSV: `2025-07-24` then `2026-02-09`. | **unsupported** (opposite of the rehearsal) | `inventory-selection.service.ts` scan; `loadExportableAllocations`; `docs/validation/customer-journey-e2e-mvp-evidence.json` step 10.4 | **Medium.** Oldest leads appear first. |
| 11. ~5% extra usable inventory | Selection reserves `min(eligible, requestedQuantity)`. `PPL_SELECTION_ELIGIBLE_SAFETY_MARGIN = 25` is a **scan buffer** for commit races, not reserved or exported extra. Priced orders cannot silently raise qty. | **unsupported** as customer overage | `inventory-selection.service.ts` (`slice(0, requestedQuantity)`); `priced-quantity-enforcement.ts`; runbook partial-fill example | **High** if Alex will delete rows. A 50-lead order yields 50 exported rows, not 53. |
| 12. Supplemental / replacement for cleanup removals | Replacement exists but is flag-gated, **duplicate-only**, requires proven SA360 evidence, and runs **after** delivery. Quality / invalid_name / incomplete_name are explicitly unsupported. FOWB hides the workflow unless `SA360_PPL_REPLACEMENT_ENABLED=true`. A second Client Lead Order is the only supported way to replace cleanup rejects. | **unsupported** for cleanup rejects; **partially automatic** for proven duplicates after release | `replacement.service.ts` (`UNSUPPORTED_REPLACEMENT_REASON_CODES`, `isDuplicateReasonCode`); runbook §4 / §8 | **High.** The 16-lead rehearsal replacement is still a **second order**. |

---

## 3. Exact current customer CSV schema

Active schema is **niche-scoped**. Historical packages keep their stored bytes forever.

| Niche | Schema | Header (exact, comma-separated) |
| --- | --- | --- |
| `vet` (new exports) | `buyer_csv_v3` | `first_name,last_name,phone,email,state,zip,age,lead_date,niche,beneficiary,coverage_amount,branch_of_service,disability_rating,primary_concern` |
| `trucker` (new exports) | `buyer_csv_v3` | `first_name,last_name,phone,email,state,zip,age,lead_date,niche,beneficiary,coverage_amount,rig_type,company_or_independent` |
| `nurse` / `mortgage` / `solar` / unknown (new exports) | `buyer_csv_v2` | Base `first_name,last_name,phone,email,state,lead_date,niche,beneficiary,coverage_amount` plus niche extras (`healthcare_profession,primary_concern` / `homeowner,house_type` / none) |
| Any historical package | stored `fieldSchemaVersion` | Unchanged on replay |

**Observed released Vet file** (customer-journey harness, not a new run):

```text
first_name,last_name,phone,email,state,zip,age,lead_date,niche,beneficiary,coverage_amount,branch_of_service,disability_rating,primary_concern
Clean4,Lead,+15551001004,beta.clean.4@example.test,NC,,,2025-07-24,vet,,,,,
Clean3,Lead,+15551001003,beta.clean.3@example.test,NC,,,2026-02-09,vet,,,,,
```

Filename (portal and operator): `<Client>_<OrderNumber>_<NICHEKEY>_<States>_<Bucket>_<N>-leads.csv`  
Example: `Journey-Valley-Vet_LO-1064_VET_NC_bucket_2-leads.csv`

### Internal terminology leaking into the customer export

| Leak | Where |
| --- | --- |
| Snake_case headers (`first_name`, `lead_date`, `coverage_amount`, `branch_of_service`, …) | CSV header |
| `niche` key `vet` / filename `VET` | Column + filename |
| `lead_date` instead of `Date Generated` | Header |
| `coverage_amount` instead of omitting Coverage Amount | Header + empty cells |
| `zip` / `age` / `beneficiary` / niche extras always present | Header |
| Commerce bucket slug in filename (`1-3mo`, `bucket`) | Filename only (not CSV bytes) |

Allowlist **does** keep these out of the CSV: `source_agent`, `supplier`, `leadUid`, `allocation`, `cost`, `proof`, `date_of_birth`, `campaign_name`, `Used By`, `STATUS`, `rawPayloadJson`, allocation/inventory ids.

The published operator runbook (`docs/demo/ppl-aged-inventory-beta-runbook.md`) still describes new exports as `buyer_csv_v2`. Code on master activates v3 for Vet/Trucker. Treat the runbook as stale on schema.

---

## 4. Quantity reconciliation example — 50-lead priced order

Assume a priced Client Lead Order, one commerce bucket, selection complete (not `scan_limit_reached`), and enough eligible inventory.

| Stage | Count | Source of truth |
| --- | --- | --- |
| Requested | **50** | `LeadOrderLine.requestedQuantity` (authoritative). Request-body qty cannot differ (`priced_quantity_mismatch`). |
| Eligible scanned | ≥ 50, up to 50+25 | Bounded scan target = requested + `PPL_SELECTION_ELIGIBLE_SAFETY_MARGIN` (25). Extra 25 are **not** reserved. |
| Selected / reserved | **50** | `candidates.slice(0, requestedQuantity)` then one `LeadAllocation` per item, status `reserved`. |
| Export preview / commit `rowCount` | **50** | Count of allocations in `reserved` \| `delivering` \| `committed` with an inventory item. `selectedRowCount` in package metadata = that row count. |
| Released / customer download rows | **50** | Same immutable `csvContent`. `markSpreadsheetDelivered` commits those 50 allocations and writes 50 `BuyerDeliveredIdentity` rows. |
| Customer fulfillment presenter | **50 of 50** | `committedAllocationCount` vs requested. Stored `LeadOrder.fulfilledQuantity` is **not** incremented on this path and must be ignored. |

**No hidden mismatch on the happy path.** Requested = reserved = exported = released = customer fulfillment count.

Mismatches that *can* appear:

| Situation | What the customer / ledger shows |
| --- | --- |
| True inventory shortfall (e.g. 47 eligible) | Selected/exported/released 47; requested stays 50; remaining 3; FOWB “potential credit” is ops-only, not an automatic refund. |
| `scan_limit_reached` | No reservation. Do not treat as shortfall. |
| Alex deletes 3 rows from a **local** copy and emails 47 | Portal download after release is still **50**. Identities recorded: **50**. Commercial remaining: **0**. The cleaned file is outside SA360. |
| Alex releases 3 reserved allocations via `POST /admin/v1/fulfillment-ops/allocations/:id/release` **before** export commit, then exports | Export/release = 47; requested still 50; remaining 3. FOWB has **no** row-release UI; API only. |
| Replacement (duplicate, flag on) | Increments `requestedQuantity` by 1 and adds one reserved allocation. A later export of the same order includes **all** exportable statuses (`reserved`, `delivering`, `committed`), so a second package can re-include already-committed rows plus the replacement. |

Journey harness confirmation (partial fill, not 50): requested 5 / reserved 2 / released CSV 2 / linked leads 2 / remaining 3. Three views agreed. `fulfilledQuantity` stayed 0.

---

## 5. Current handling of rejected / unusable leads

There is **no** pre-release “accept these rows / reject those rows / backfill” workflow on the PPL CSV path.

| Unusable class | What happens today |
| --- | --- |
| Missing consumer age, 1-char / multi-part names, blank ZIP, blank coverage | Still eligible (those fields are not eligibility). Still reserved. Still exported. Operator deletes them in Excel if at all. |
| No phone **and** no email | Selection `invalidIdentity`. Not reserved. |
| Phone **or** email present (not both required) | Eligible. Missing phone or missing email can still export as a blank cell. |
| Malformed email on PPL export | No format check. Fingerprint is `trim().toLowerCase()`. Aged-bulk **intake** can null an invalid email (`invalid_email_format`) and still accept on phone. |
| Missing / non-canonical state | Selection excludes (`unavailableInventory`). Aged-bulk intake rejects `reject_invalid_state`. |
| Same identity twice in one selection batch | `currentBatchDuplicate` — one reserved, extras skipped. |
| Same buyer already received that phone/email | Excluded only if a `BuyerDeliveredIdentity` row exists (written at Approve & Release, not at reserve/export). |
| Same physical inventory item | `maxFulfillments` default 1; reserved/committed items are not `available`. |
| Quality / bad name / no age after the customer already has the file | Replacement **denied** (`invalid_reason_code`). Place a **second order**. |
| Proven duplicate after delivery | `LeadReplacementRequest` if `SA360_PPL_REPLACEMENT_ENABLED=true`, evidence proven, `APPROVE REPLACEMENT`. One-for-one reserve; original stays committed. Runbook: do not use this on first beta. |
| Reserved but not yet released, operator wants it out | `releasePplAllocation` returns the item to `available` and decrements `reservedQuantity`. Not exposed in FOWB. Must happen **before** `markSpreadsheetDelivered`. |

After export commit the package is **immutable**. There is no “re-export cleaned bytes into the same package.” A new commit with a new idempotency key creates a **new** package from whatever allocations are still exportable.

---

## 6. ~5% overage — system, runbook, or unnecessary?

**Operator runbook behavior — not system behavior, not unnecessary.**

- Architecture reserves **exactly** the priced requested quantity (or fewer on confirmed shortfall).
- The +25 scan margin is only so commit-time revalidation can absorb races. It is not delivered.
- Cleanup will remove rows. If Alex promises 50 usable leads and the rehearsal drop rate holds, the generated file will be short after cleanup.
- Raising requested quantity to 53 changes the **commercial** contract (quoted total, customer “50 of 53” remaining) unless product later splits “promised usable” from “reserved.” That is out of scope here.
- Practical first-beta choices, without new architecture:
  1. Request 50, clean, accept a shortfall or place a small **second order** for removed rows (this is what the 16-lead rehearsal already did).
  2. Request ~53 only if commercial/ops explicitly agree the customer is buying 53 and may receive a cleaned 50 plus extras — do not do this silently.
  3. Do **not** expect SA360 to reserve 53 and commit 50.

Recommendation for the first controlled buyer: **keep requested = promised qty**, plan a supplemental order if cleanup drops rows, and do not encode 5% in the selector.

---

## 7. Findings

### P0

1. **Portal download after release is the raw generated package.** Local Excel cleanup does not change `LeadDeliveryExportPackage.csvContent`. If the first beta customer is portal-enabled and Alex Approve & Releases, they can download the uncleaned `vet` / snake_case / oldest-first file even if Alex emailed a cleaned copy.  
   *Guardrail:* send the cleaned file out of band; do not treat portal download as the delivery file until a later presentation change exists. If identities must be recorded, release only after ops accepts that the portal file is the official one.

2. **No delivery-quality gate for consumer age or name policy.** Selection will fill a 50-lead order with blank-age and one-character-name rows. The rehearsal then required a 16-lead replacement order. That gap is still open.

### P1

3. Customer schema ≠ rehearsal schema (labels, order, `vet` vs `Veteran`, empty ZIP/coverage columns).  
4. Sort is oldest `generatedAt` first, not newest first. `lead_date` **is** source `generatedAt` (UTC date-only), not reserved/released time.  
5. Same-buyer identity exclusion starts at Approve & Release, not at reserve. Two open reservations for the same buyer can still share an identity across items until the first package is marked delivered.  
6. Quality rejects cannot use the replacement path. Second order required.  
7. Operator runbook schema section is stale (still `buyer_csv_v2` for all new exports).

### P2

8. Phone **or** email is enough; missing phone is not blocked.  
9. PPL export does not re-validate email format.  
10. `releasePplAllocation` exists in the admin API but not in FOWB, so dropping bad reserved rows before export is a hidden API step.  
11. Filename leaks `VET` / bucket slug. Harmless to bytes/SHA; visible to the customer.

### P3

12. FOWB export preview already shows `optionalFieldCoverage` (e.g. `age: 0 / 50`). Use it as a cleanup signal; it does not block commit.  
13. Historical v1/v2 packages replay without rewrite — correct, but a v1 package would be even further from the rehearsal file.

---

## 8. Smallest recommended changes before beta (do not implement here)

Do **not** build replacement/refund architecture. Do **not** change export behavior in this audit.

If the first beta is **operator-emailed spreadsheet only** (customer not told to use portal download):

1. Add an Alex checklist to the existing runbook (cleanup only; no code): drop blank `age`; drop 1-character first/last; drop multi-part / spaced names per current delivery policy; delete empty ZIP and Coverage Amount columns if unused; move `lead_date` to column A as `Date Generated`; move niche to B as `Lead Type` with value `Veteran`; sort `Date Generated` descending; confirm row count vs promised qty; if short, cut a second order.  
2. Use FOWB optional-coverage tiles before commit so Alex knows how many blank `age` / `zip` / `coverage_amount` cells are coming.  
3. Keep replacement flag **off**.  
4. After sending the cleaned file, decide explicitly whether to Approve & Release (records identities, unlocks portal raw file) or hold release until portal is the intended channel.

If the first beta customer **will** download from the portal:

5. The generated file is **not** sufficient. Smallest later product change (separate task): a presentation-only serializer (headers/order/Veteran label/omit empty ZIP & coverage/newest-first) **or** an operator “replace package bytes before release” step. That is a contract change; do not sneak it into this audit.

Overage: document as runbook, not selector behavior.

---

## 9. Safety (F)

| Rule | Status | Evidence |
| --- | --- | --- |
| Generated ≠ Released | **Holds** | `commitBuyerCsvExport` writes package with `spreadsheetDeliveredAt` null. Download/admin preview does not set it. Only `markSpreadsheetDelivered` + `MARK SPREADSHEET DELIVERED` writes identities and commits allocations. |
| Customer cannot access an unreleased package | **Holds** | `lead-delivery-export-package.repository.ts` `releasedWhere` requires `spreadsheetDeliveredAt: { not: null }`. Client list/get/download return null / empty / 404. Tests in `client-lead-order-exports.routes.test.ts` and `lead-order-released-deliveries.service.test.ts`. Journey: unreleased package hidden, then download 200 after release. |
| Tenant isolation | **Holds** | Journey tenant B received 404 / “Delivery not found” on tenant A export and download. |
| Notify is not release | **Holds** | Notification runs only after mark-delivered; export commit leaves notify status null. |

PPL/LF2/GHL/NextGen flags were **not** turned on for this audit.

---

## 10. Code path map (today)

```text
Priced Client Lead Order (LeadOrderLine.requestedQuantity)
  → previewPplInventorySelection / commitPplInventorySelection
       identity: phone OR email fingerprint
       exclude: BuyerDeliveredIdentity (same client), batch dups, protected agent,
                non-canonical state, non-available, commerce-excluded, age-bucket miss
       order: generatedAt ASC
       reserve exactly requested (or partial on confirmed shortfall)
  → previewBuyerCsvExport / commitBuyerCsvExport
       allocations reserved|delivering|committed, proposedAt ASC
       vet/trucker → serializeBuyerCsvV3
       else → serializeBuyerCsvV2
       immutable LeadDeliveryExportPackage
  → operator download (FOWB) — not released
  → markSpreadsheetDelivered
       BuyerDeliveredIdentity + allocation/item committed
       notifyCustomerDeliveryReleased
  → GET /client/v1/lead-orders/:id/exports/:exportId/download
       only if spreadsheetDeliveredAt set and tenant matches
```

---

## 11. Tests / builds run for this audit

Validation-only. No PPL flags set (`SA360_PPL_*` and `SA360_LF2_*` unset). No production writes.

Focused existing contract suite (Node test runner, local `@sa360/api` files only):

| Check | Result |
| --- | --- |
| buyer-csv-export allowlist | pass |
| buyer_csv_v2 / v3 contracts | pass |
| buyer-lead-fields | pass |
| PPL CSV beta contracts | pass |
| eligibility optional-fields (age/zip never select) | pass |
| priced-quantity-enforcement | pass |
| replacement flags (duplicate-only, default off) | pass |
| buyer-csv-filename | pass |
| lead-order fulfillment presenter (5/2/3) | pass |
| client export routes (unreleased invisible) | pass |
| released-deliveries service | pass |
| commerce-lifecycle (`DATE_MISSING` ≠ consumer age) | pass |
| **Total** | **75 passed / 0 failed** |

Log: `/opt/cursor/artifacts/beta-delivery-quality-audit-tests.log`

The customer-journey harness was **not** re-run. Schema, sort, and quantity facts reuse `docs/validation/customer-journey-e2e-mvp-evidence.json` from master (#99).

---

## 12. Report box

| Item | |
| --- | --- |
| Root cause / rationale | Delivery rehearsal is a **presentation and quality** standard. Current PPL export is a **buyer-safe identity dump** (allowlisted columns, Generated ≠ Released, exact qty). Those are different jobs. |
| Files changed | This document only. |
| Migrations | None. |
| Risks | First portal-enabled customer receives the raw v3 file if Alex releases. Cleanup without a second order under-delivers. Runbook schema text is stale. |
| Follow-up dependencies | Optional later presentation serializer or pre-release package rewrite (Portal/Quality product task). Runbook cleanup checklist. Do not activate PPL/LF2/GHL for this decision. |
