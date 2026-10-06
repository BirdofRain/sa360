# LO-1055 production completion — COMPLETE via the normal path (2026-10-06)

Follow-up to `lo1055-production-recovery-2026-10-05.md`, which left LO-1055 unmutated and
blocked in Phase 2. With PR #160 (aged bulk CSV lane + scoped ops-verify) and PR #161
(reservation transaction budget) deployed, the order was completed end to end through the
deployed Admin API and the existing ops-verify service. **No enlarged one-off Prisma client was
used.** LO-1057 was not touched.

## Phase 0 — production preflight

| Field | Value |
| --- | --- |
| Production API | `https://sa360-sw6oq.ondigitalocean.app` |
| `/health` `commitSha` | `29a58f4f55fd3c1e537b870d67a73a7298dcc515` |
| PR #161 merge commit | `29a58f4f55fd3c1e537b870d67a73a7298dcc515` (merged `2026-10-06T02:14:44Z`) |
| Local tree vs deployed commit | identical (`git rev-parse HEAD^{tree}` == `29a58f4^{tree}` == `bbdd5d65…`) |
| Flags | `SA360_PPL_SELECTION_ENABLED=true`, `SA360_PPL_CSV_EXPORT_ENABLED=true`, `inventoryReviewEnabled=true`, `liveDeliveryEnabled=false` |

Production therefore includes PR #161 before any write was issued.

Order `LO-1055` (`cmuvmbg0j0046ni0uiz3is1kg`, `jonathon_cruz`) was still byte-for-byte unmutated:
`status active`, `requested 85`, `proposed 0`, `reserved 0`, `fulfilled 0`, 0 allocations,
0 export packages, 0 `BuyerDeliveredIdentity`.

Baseline Selection Preview reproduced the blocked state exactly: `eligible 51`, `selected 51`,
`shortfall 34`, `creditStatus confirmed_shortfall`.

## Phase 1 — minimal scoped activation (34 rows, the exact shortfall)

`lo1055-candidate-scan.ts` (read-only, canonical selector helpers): 254 `pending_review` cohort
rows, **226 would-be-eligible**, 28 blocked entirely by `not_buyer_ready`. The oldest 34 were
taken (FIFO, `generatedAt asc`) — exactly the measured shortfall, no margin.

**Review preview before verify** (`writesPerformed 0`): 34 requested, **0 eligible**, blockers
`identity_normalization_incomplete 34` + `duplicate_status_unchecked 34`.
`source_lane_unrecognized` is **gone** — PR #160's lane fix is live, and `sourceLane` now reports
`aged_inventory_bulk_csv` as recognized.

**Scoped ops-verify** (`runAgedInventoryOpsVerify`, unchanged service) wrote the missing
`LeadVerificationResult` rows:

| Field | Value |
| --- | --- |
| requestId | `lo1055-prod-opsverify-20261006-lotA-001` |
| lot | `lot_aged_recovery_historical_parser_vet_b4471cf183f8` |
| mode / confirmation | `verify` / `VERIFY AGED INVENTORY LOT` |
| processed / passed / quarantined / rejected | 34 / 34 / 0 / 0 |
| `lotScale` / `scopedItemCount` | `false` / `34` |

All 34 candidates were in one lot, so a single scoped run sufficed. Verify writes no inventory
status for passing rows, so nothing became sellable at this step.

**Review preview after verify**: 34 eligible, 0 blocked, `duplicateStatus UNIQUE`,
`selectionFingerprint 796ecff0e1ebb655b410507f32aa33c9619fbd3800b46b4a4915c9da93fd3cfc`.

**Activation through the deployed Admin API** —
`POST /admin/v1/lead-inventory/review/actions/commit`, **HTTP 201 in 1,274 ms**:

| Field | Value |
| --- | --- |
| requestId | `lo1055-prod-activation-20261006-001` |
| actionType / confirmation | `make_available` / `MAKE REVIEWED INVENTORY AVAILABLE` |
| actionStatus | `applied` |
| requested / eligible / applied / blocked | 34 / 34 / 34 / 0 |
| resulting statuses | `available: 34` |

The forbidden 7,062-row lot-scale activation was never used.

## Phase 2 — reservation through the normal HTTP route

Rerun Selection Preview: `eligible 85`, `selected 85`, `shortfall 0`, `creditStatus exact_fill`,
85 unique `selectedItemIds`, `rowsScanned 107`.

`POST /admin/v1/fulfillment-ops/orders/{orderId}/selection/commit`:

| Field | Value |
| --- | --- |
| idempotencyKey | `lo1055-production-selection-v1` |
| HTTP status | **200 OK** |
| duration | **3,375 ms** |
| deployed transaction budget | `PPL_SELECTION_TRANSACTION_TIMEOUT_MS = 90,000 ms` (PR #161) |
| selected / shortfall | 85 / 0 |
| allocationIds | 85, all unique |

The route that previously returned an opaque HTTP 500 (P2028) now completes at ~3.8 % of the
deployed budget. No workaround, no injected Prisma client.

## Phase 3 — export

| Step | Result |
| --- | --- |
| Export Preview | `rowCount` **85**, `fieldSchemaVersion buyer_csv_v4`, 14 columns |
| Export Commit (`lo1055-production-export-v1`) | HTTP 200, 285 ms, `exportId cmuw2c0tx007an20uqwlaau2d`, `rowCount 85` |
| `contentSha256` (preview == commit == download header == stored == recomputed) | `997d7df18e13a03f01be3c769446ffe2bf9846d3d5a49e1767f53d2d0fcaa378` |
| Filename | `Jonathon-Cruz_LO-1055_VET_IN-SC-AZ_1-3mo_85-leads.csv` |

### CSV validated internally (no PII printed)

Downloaded to a work directory outside the git tree and validated with an RFC4180 parser that
emits only counts, hashes, and column names:

- 85 data rows, 14 columns, 0 ragged rows
- `First Name` / `Last Name` / `Phone` / `Email` / `State` / `Date Generated` populated on all 85
- 85 distinct phone fingerprints and 85 distinct email fingerprints — no intra-package duplicates
- `Lead Type` = `Veteran` on all 85 rows
- Verdict: **PASS**

`Date Generated` is date-only by contract (`leadDateOnlyUtc`), so ages computed from the CSV
round up to one day. The authoritative recheck against real `generatedAt` timestamps using
`calculateInventoryAgeDays` + `resolveCommerceAgeBucketKey` puts **all 85 rows in
`COMMERCE_1_3_MO`** (`ageDays` 30–89). No bucket violation.

## Phase 4 — release

`POST /admin/v1/fulfillment-ops/exports/{exportId}/mark-spreadsheet-delivered`:

| Field | Value |
| --- | --- |
| idempotencyKey | `lo1055-production-release-v1` |
| confirmation | `MARK SPREADSHEET DELIVERED` |
| HTTP status / duration | 200 OK / 752 ms |
| `deliveredAt` | `2026-10-06T02:33:16.906Z` |
| `deliveredBy` | `lo1055-production-run` |
| `identityCount` | 85 |
| `externalWriteOccurred` | `false` |
| customer notification | `skipped` (`missing_portal_login_email`) |

## Phase 5 — final verification

`apps/api/src/scripts/lo1055-completion-verify.ts` (read-only) — **all checks pass**:

| Check | Result |
| --- | --- |
| allocations on order | 85, all `committed`, 85 distinct inventory items |
| allocation idempotency prefix | `ppl-selection:lo1055-production-selection-v1` |
| `BuyerDeliveredIdentity` linked to order | **85** |
| `BuyerDeliveredIdentity` for `jonathon_cruz` | 85 (no leakage from other orders) |
| export packages | 1, `rowCount 85`, CSV body re-hashes to the stored sha |
| `spreadsheetDeliveredAt` | `2026-10-06T02:33:16.906Z` |
| commerce bucket of all 85 allocated items | `COMMERCE_1_3_MO` (ageDays 30–89) |
| `committedAllocationCount` | 85 → presented fulfillment `85 of 85 delivered`, status `fulfilled` |

### Idempotent replay

| Replayed call | Result |
| --- | --- |
| selection/commit `lo1055-production-selection-v1` | HTTP 200 in **120 ms** (vs 3,375 ms), identical 85-allocation id set, no new rows |
| exports/commit `lo1055-production-export-v1` | HTTP 200, `idempotentReplay true`, same `exportId` and sha |
| mark-spreadsheet-delivered `lo1055-production-release-v1` | HTTP 200, `idempotentReplay true`, same `deliveredAt`, `externalWriteOccurred false` |

`commitPplInventorySelection` short-circuits on the batch-key prefix and returns the existing
allocations; it has no `idempotentReplay` field in its response shape, so the replay is evidenced
by the identical allocation id set and the 28x faster response.

### Blast radius

| Measure | Value |
| --- | --- |
| rows made `available` in the activation window | 34 |
| collateral rows outside the review action | **0** |
| activated rows consumed by LO-1055 | 34 |
| activated rows left unsold | **0** |

### LO-1057

Not touched. Observed unchanged at `status active`, `requested 300`, `reserved 300`,
`fulfilled 0` — identical to its pre-run state.

## Follow-ups (not addressed here)

1. **`LeadOrder.fulfilledQuantity` stays 0 after release.** `markSpreadsheetDelivered` commits
   allocations, writes `BuyerDeliveredIdentity`, and commits inventory, but never advances
   `fulfilledQuantity`, `status`, or `completedAt`. Customer-facing fulfillment is correct because
   it is derived from `committedAllocationCount`, but the admin order list still renders
   `fulfilled 0` for a fully delivered order, which reads as incomplete to operators.
2. **Customer release notification skipped** — `missing_portal_login_email` for `jonathon_cruz`.
   The buyer received no automated notification of the delivered package.
3. **`State` column exports the raw source value**, not `normalizedState`: this package contains
   `South Carolina`, `SC`, `Sc`, `sc`, `S.C.`, `S.C`, `Sout.h carolina`, and
   `Columbia  SC  29203`. All 85 are in-scope states, but the buyer-facing column is inconsistent.
   Pre-existing `buyer_csv_v4` behavior, not introduced by this run.
4. **Reservation round-trip batching** (the follow-up noted in PR #161) is still open. 85 rows took
   3.4 s; the budget still has to scale with order size.
