# LO-1055 production recovery — BLOCKED on inventory activation (2026-10-05)

Authorized production operations run against `https://sa360-sw6oq.ondigitalocean.app`
(API commit `6bf877a`, PR #159) and the production managed Postgres.

**Outcome: Phases 0–1 complete, Phase 2 BLOCKED, Phases 3–5 not started, Phase 6 complete.**
LO-1055 was left byte-for-byte unmutated. No inventory status was changed. No allocation,
reservation, export, or release was created.

## Phase 0 — preflight (verified, matches ground truth)

| Field | Production value |
| --- | --- |
| `orderNumber` | `LO-1055` |
| `id` | `cmuvmbg0j0046ni0uiz3is1kg` |
| `clientAccountId` / display | `jonathon_cruz` / `Jonathon Cruz` |
| `status` | `active` (activated `2026-10-05T20:01:18.664Z`) |
| `nicheKey` | `vet` → canonical `Veteran`, aliases `vet, veteran, vet_fex, n_vet, n_veteran` |
| `states` | `IN`, `SC`, `AZ` |
| `requestedQuantity` | `85` |
| priced bucket | `COMMERCE_1_3_MO` (`1-3 Months`, `30 <= ageDays < 90`) |
| `unitPriceCents` | `600` → `lineTotalCents` `51000` |
| `reservedQuantity` / `fulfilledQuantity` | `0` / `0` |

Pre-existing fulfillment artifacts — **all zero**, so no idempotent reconciliation was required:

- `LeadAllocation` rows for the order: `0`
- `LeadDeliveryExportPackage` rows for the order: `0`
- `BuyerDeliveredIdentity` rows for `jonathon_cruz`: `0`
- buyer-seen phone/email fingerprints: `0` / `0`
- `spreadsheetDeliveredAt`: unset

Live selection funnel reproduced the reported numbers exactly: `available 73`,
`pending_review 256`, `finalEligible 51`, `selected 51`, `shortfall 34`.

## Phase 1 — exact pending-review candidate pool

`apps/api/src/scripts/lo1055-candidate-scan.ts` reuses the canonical selector policy helpers
(`prismaCommerceNicheWhere`, `buildCommerceGeneratedAtWhere`, `selectionAllowedStates`,
`calculateInventoryAgeDays`, `resolveCommerceAgeBucketKey`, `matchesCommerceAgeBucketFilter`,
`isItemExcludedByProtectedAgents`, `isOriginClientBuyerIneligible`, `buildIdentityFingerprints`,
`isPplBuyerReadyLead`, `loadBuyerSeenFingerprints`) and differs from
`queryEligibleInventoryCandidatesBounded` only by substituting `status: "pending_review"` for
`status: "available"`. It performs no writes.

Result — **228 of the 256 pending rows would already satisfy the real LO-1055 selector** if
their only remaining lifecycle issue were `pending_review`:

- `wouldBeEligible`: **228**
- blocked: `28`, entirely `not_buyer_ready` (multipart/short-name policy — retained, not weakened)
- `ageDays` range: `47..89` (every row inside `30 <= ageDays < 90`)
- state distribution: `SC 102`, `AZ 70`, `IN 56`
- niche distribution: `vet 228`
- protected-agent / origin-client / same-buyer / invalid-identity / duplicate exclusions: `0`

So qualifying inventory is **not** scarce. 34 more leads were needed and 228 were available.

## Phase 2 — BLOCKED: no production path can activate this inventory lane in a targeted way

Only three code paths in the deployed commit transition `pending_review → available`:

### 1. Targeted per-item audited review path — hard-blocked by a code defect

`POST /admin/v1/lead-inventory/review/actions/{preview,commit}` →
`previewLeadInventoryReviewAction` / `commitLeadInventoryReviewAction` →
`assessLeadInventoryActivationEligibility`.

The feature flag is **enabled** in production and the endpoint responds correctly, but a
100-item preview (`lo1055-availability-20261005-probe-001`, `writesPerformed: 0`) returned
`eligibleCount: 0`, `blockedCount: 100`, with every row carrying the same three blockers:

```
source_lane_unrecognized            100
identity_normalization_incomplete   100
duplicate_status_unchecked          100
```

Single-item proof (`lo1055-blocker-proof-20261005-001`, item `cmt1lp7uu09qd7qyke0ipftu1`,
age 87, SC): `blockerCodes = source_lane_unrecognized, identity_normalization_incomplete,
duplicate_status_unchecked`, `sourceLane = aged_inventory_bulk_csv`,
`duplicateStatus = UNCHECKED`, `allowedActions = []`.

Root causes:

- **`source_lane_unrecognized` is unfixable at runtime.**
  `REVIEW_RECOGNIZED_SOURCE_LANES` (`apps/api/src/services/lead-inventory-review/lead-inventory-review.constants.ts`)
  contains `aged_inventory_csv`, but the real production lane for this entire inventory class
  is **`aged_inventory_bulk_csv`**. Both `item.sourceLane` and the event's canonical lane
  resolve to `aged_inventory_bulk_csv`, so `resolvedLane` can never match. This blocks
  **every aged bulk CSV row in production**, including the 15,975 rows that are already
  `available` — they would also fail review eligibility today.
- **`identity_normalization_incomplete` + `duplicate_status_unchecked`** because these rows have
  **no `LeadVerificationResult` row at all** (`<no row>` for 626/627 cohort rows). The ops-verify
  pass that writes `PASSED`/`UNIQUE` ran on `2026-07-30` against lot
  `lot_aged_bulk_vet_382fb5296124`; the two recovery lots holding these candidates were created
  `2026-08-20`, after that pass, and were never verified.

### 2. Lot-scale ops-verify activation — available, but a 140× over-activation

`runAgedInventoryOpsVerify` (`apps/api/src/services/aged-inventory-ops-verify/aged-inventory-ops-verify.service.ts`)
is the service that actually activated production aged inventory in July (audit header
`prod-vet-activate-2026-07-30-v1:review`, `applied 215934`, `blocked 0`). It preserves everything
required: operational eligibility assessment, `LeadInventoryReviewAction` audit header, per-item
`LeadInventoryReviewItemResult` rows, `availableAt`, and the
`MAKE REVIEWED INVENTORY AVAILABLE` confirmation phrase.

**But `OpsVerifyArgs` has no item-id or predicate filter — it is lot-scoped only.** Measured
blast radius (`apps/api/src/scripts/lo1055-lot-blast-radius.ts`):

| Lot (`aged_inventory_bulk_csv`, active, niche `vet`) | pending_review | in LO-1055 scope | collateral |
| --- | --- | --- | --- |
| `lot_aged_recovery_historical_parser_vet_b4471cf183f8` | 6,195 | 182 | 6,013 |
| `lot_aged_recovery_post_snapshot_vet_b4471cf183f8` | 867 | 73 | 794 |
| **total** | **7,062** | **255** | **6,807** |

The collateral set includes **3,370 rows aged 90–179 days and 504 aged 180+** — inventory
belonging to entirely different commerce buckets that would become sellable as a side effect of
fulfilling one 85-lead order. That is precisely the "globally activate all pending inventory"
outcome the task forbids, so this path was **not** used.

### 3. Campaign intake activation — not applicable

`assessCampaignInventoryIntakeActivation` only runs at campaign intake time for campaign lanes
(`meta_lead_ads`, `leadcapture_io`).

### Why the run stopped here

Reaching 85 would have required one of:

1. a code change to `REVIEW_RECOGNIZED_SOURCE_LANES` plus an ops-verify pass — **deploying
   application code**, excluded from this operational run;
2. lot-scale activation of 7,062 rows — **explicitly forbidden**;
3. raw `UPDATE LeadInventoryItem SET status='available'` — **explicitly forbidden**, and it would
   skip the review audit, eligibility evaluation, and `availableAt` semantics.

Reserving the 51 currently-eligible leads was also declined: the task permits partial reservation
only when no qualifying inventory remains, and 228 qualifying rows remain. A 51-lead reservation
would have consumed inventory into a partial, non-compliant state against a `$510`/85-lead order.

### Minimal remediation (proposed, NOT applied)

1. Add `aged_inventory_bulk_csv` to `REVIEW_RECOGNIZED_SOURCE_LANES`. This aligns the review
   constant with the real production lane and is required for *any* targeted review action on
   aged bulk inventory.
2. Give the aged ops-verify service an optional `inventoryItemIds` / predicate filter so operators
   can verify + activate a bounded set instead of a whole lot.

With (1) and (2) deployed, Phase 2 becomes a single audited 50-row `make_available` commit and
Phases 3–5 should run unmodified.

## Phases 3–5 — not started

No selection commit, export preview/commit, or release was attempted, because Phase 4 requires
`rowCount = 85` and the task requires stopping rather than exporting a short package. No
idempotency keys were consumed: `lo1055-production-selection-v1`,
`lo1055-production-export-v1`, and `lo1055-production-release-v1` are all still unused.

## Phase 6 — live Kanban updated (COMPLETE)

Board `sa360_beta_mvp_launch` via the production Kanban Admin API. Board went from 71 → 75 cards;
all four cards were absent beforehand so all four were created, each exactly once (verified by a
re-fetch matching on exact title and on the `ux-p0-2026-10-05` tag cohort, which returns exactly 4).

| Card ID | Title | Status | Priority | Workstream | Tags | AC |
| --- | --- | --- | --- | --- | --- | --- |
| `cmuvtd53i003km80ueqqtdlnj` | C.O.C. interaction feedback + perceived-hang hardening | DOING | P0 | Dashboard | 6 | 8 |
| `cmuvtdpqk003nm80uux94y3d0` | Lead Inventory bulk review UX — filters, search, select-all, batch actions | DOING | P0 | Inventory | 6 | 14 |
| `cmuvtd58q003lm80uhac6e692` | Fulfillment Ops guided one-screen aged-order execution | DOING | P0 | Fulfillment | 5 | 11 |
| `cmuvtd59w003mm80u44hvkkkn` | Admin C.O.C. performance audit + load-time budget | TO DO | P1 | Dashboard | 4 | 8 |

Note: `Dashboard`, `Inventory`, and `Fulfillment` are new workstream values on this board — the
existing vocabulary uses `Admin C.O.C.`, `Review Queue`, etc. The requested values were used
verbatim as specified; remap if the board should keep a closed workstream vocabulary.

## Audit trail

| Item | Value |
| --- | --- |
| Production API commit | `6bf877a` (`/health` `commitSha 6bf877ad…`) |
| Review previews (no writes) | `lo1055-availability-20261005-probe-001`, `lo1055-blocker-proof-20261005-001` |
| Review commits | **none issued** |
| Selection / export / release keys | **all unused** |
| Inventory rows mutated | **0** |
| LO-1055 mutations | **0** (`reserved 0`, `fulfilled 0`, `status active`, post-run preview still `51/85`) |
| Kanban cards created | 4 (IDs above) |

Read-only diagnostic scripts retained for re-verification:
`apps/api/src/scripts/lo1055-candidate-scan.ts`,
`apps/api/src/scripts/lo1055-lane-diagnose.ts`,
`apps/api/src/scripts/lo1055-lot-blast-radius.ts`.
