# LO-1060 portal aged line repair — authorized apply only (do not run from this PR)

This is an **idempotent, explicitly authorized** repair for production order
`LO-1060`. This PR does **not** apply it. Do not create a `LeadOrderLine`,
change status, reserve inventory, export, reprice, merge, or deploy without a
**separate** operator authorization that follows the procedure below.

## Why a repair is needed

Customer-portal aged create previously persisted the requested commerce age
bucket only inside `notes` (`sa360.portalAgedOptions.v1`). Stage 2b / export
require a structured `LeadOrderLine` with `ppl_order_line_pricing_v1`.
`createClientLeadOrder()` now writes that line for **new** orders in the same
Prisma `leadOrder.create` as the order (nested `orderLines.create` is one
database transaction). `LO-1060` was created before that write.

## Phase A — required production read (operator)

Use existing authorized **read-only** production access. Do not use write
credentials. Confirm every field against the live row — do not infer the
bucket from a screenshot. Missing, null, NaN, negative, or unavailable
reservation / export / delivery counts are **unverified**, never zero.

| Check | Pass condition |
| --- | --- |
| `orderNumber` | `LO-1060` |
| Notes markers | notes contain **exactly one** `sa360.portalAgedOptions.v1` object |
| Requested bucket | that object has `requestedAgeBucket === "COMMERCE_6_9_MO"` |
| Shortfall | `shortfallPolicy` is `REFUND_UNFILLED` or `ALLOW_OLDER_WITH_PRICE_ADJUSTMENT` |
| `LeadOrderLine` set | the **complete** line set is loaded; zero lines, or exactly one priced line that matches niche, states, qty, bucket, unit price, pricing version, and line total |
| Unrelated lines | any unrecognized / non-PPL / extra priced line **blocks** |
| Status | live status is `submitted`, `ready`, or `active`, and matches the original snapshot |
| Payment | live `paymentConfirmationStatus` matches the original decision |
| Buyer / niche / states / qty | unchanged from the original snapshot (`vet`; CO, KS, CT, DE, FL, GA, HI, AZ; qty 3) |
| Quoted price | original quoted unit price and pricing version are independently known (`300` / `ppl_aged_beta_2026_08_v1` only if the live notes + catalog still prove that) |
| Reservations | `reservedQuantity`, `fulfilledQuantity`, `proposedQuantity` are verified integers `= 0` |
| Allocations | verified `allocationRowCount = 0` — **every** `LeadAllocation` row, including `released`. Current counters of 0 do not hide history. |
| Exports | verified `LeadDeliveryExportPackage` count `= 0` |
| Receipts | verified `BuyerDeliveredIdentity` count for those allocations `= 0` |
| Counter consistency | order counters agree with the allocation rows |

This Cloud Agent environment has **no production admin key / doctl**. Read-only
probes on 2026-10-14:

- `GET https://sa360-sw6oq.ondigitalocean.app/health` → 200, `commitSha` `2e2a9e1`
  (the pre-fix production revision)
- `GET /admin/v1/lead-orders/LO-1060` without an admin key → 401 Unauthorized

No production row was read or written.

## Evaluator (fail-closed)

`evaluatePortalAgedOrderLineRepair()` in
`apps/api/src/services/lead-order/portal-aged-commerce.ts` is read-only.

It is eligible only when **all** of the following are independently verified:

1. Exactly one valid `sa360.portalAgedOptions.v1` marker with one canonical
   commerce age bucket and one valid shortfall policy.
2. The complete `LeadOrderLine` set is present as a real array. Unrelated or
   conflicting lines fail closed.
3. Reservation / export / delivery counts **and** `allocationRowCount` (every
   `LeadAllocation` row, including `released`) are verified non-negative
   integers (never coerced from missing / null / NaN / negative / non-integer).
4. Those verified counts are all `0`. A released allocation still counts. Zero
   current reserved/fulfilled counters do **not** hide historical activity.
   No historical-allocation recovery policy is approved; a supplied policy is
   ignored and still blocks.
5. A complete original snapshot is supplied: buyer, niche, states, requested
   quantity, payment decision, status, quoted unit price, pricing version.
6. Live order fields still match that snapshot.
7. Current catalog price and pricing version match the snapshot.
8. If one priced line already exists, it matches niche, states, quantity,
   bucket, unit price, pricing version, and line total → `alreadyRepaired`.

Fail-closed codes:

- `comparison_evidence_incomplete` — missing snapshot or unverified line set
- `counts_unverified` — a count is missing, null, NaN, negative, or non-integer
- `notes_marker_conflict` — more than one marker
- `notes_request_incomplete` — missing/ambiguous bucket or shortfall
- `unrecognized_existing_line` — a line is not a priced PPL line
- `conflicting_priced_order_line` — existing priced line disagrees
- `fulfillment_already_started` — inventory, export, receipt, or any historical
  allocation row (including released)
- `row_lock_unavailable` — `SELECT … FOR UPDATE` is missing or did not lock the order
- `order_status_changed` — live status drifted or is not repairable
- `original_request_changed` — buyer / niche / states / qty / payment drifted
- `original_price_unrecoverable` — catalog no longer matches the confirmed quote
- `priced_line_unavailable` — catalog cannot price the verified bucket
- `counts_inconsistent` — order counters disagree with allocation rows
- `authorization_required` / `repair_environment_blocked` / `authorization_order_mismatch`
- `concurrent_repair_conflict` — unique or serializable race did not resolve to
  a matching already-repaired line

## Exact separately authorized apply procedure

Do **not** run this against production from this PR, CI, or an unattended agent.
Do **not** reserve inventory, change payment, merge, or deploy as part of the
repair.

The apply implementation is `applyAuthorizedPortalAgedOrderLineRepair()`. It
re-reads the order, the complete line set, **all** allocation rows (any
status), export packages, and delivery receipts inside one `Serializable`
transaction. `SELECT … FOR UPDATE` on `LeadOrder` is required; a missing lock
capability fails closed. It creates at most one `LeadOrderLine`
(`lineNumber = 1`). A `P2002` unique race **aborts that transaction** and
retries once in a **fresh** transaction that re-locks and re-evaluates live
evidence. It never continues querying inside the aborted transaction. A
`P2034` / `40001` serialization conflict also retries once in a fresh
transaction, then fails closed. `orderKind` / `fulfillmentMode` /
`requestedQuantity` are backfilled only when null / unset. Status, payment,
notes, buyer, niche, states, and quantity are never changed.

### Preconditions (all required)

1. This PR (portal aged-order handoff + repair-safety hardening) is **merged
   and deployed** to the production API revision that contains
   `applyAuthorizedPortalAgedOrderLineRepair()`.
2. A human operator with **read-only** production access has filled the Phase A
   evidence table from the live `LO-1060` row. Screenshot-only evidence is
   insufficient.
3. A **separate written authorization** exists for this one order. It must
   name:
   - ticket id (opaque string)
   - `orderNumber = LO-1060`
   - the complete expected snapshot (buyer, niche, states, qty 3, payment
     decision, status, `unitPriceCents`, `pricingVersion`)
   - the operator who verified Phase A
4. Production process environment has
   `SA360_PORTAL_AGED_LINE_REPAIR_TICKET=<that exact ticket>` and **no other**
   repair ticket. The apply function refuses `environment: "authorized_production"`
   unless this env value equals the authorization ticket.
5. No other write to `LO-1060` (reserve, export, payment, status) is in flight.

### Apply steps (authorized operator only)

1. Confirm the production API revision SHA includes this repair function.
2. Re-read `LO-1060` plus allocation / export / receipt counts (Phase A).
3. Call **only**:

   ```ts
   await applyAuthorizedPortalAgedOrderLineRepair(
     {
       orderId: "<live LO-1060 id>",
       expected: {
         clientAccountId: "<verified buyer>",
         nicheKey: "vet",
         states: ["CO", "KS", "CT", "DE", "FL", "GA", "HI", "AZ"],
         leadVolume: 3,
         paymentConfirmationStatus: "<verified payment decision>",
         status: "<verified submitted|ready|active>",
         unitPriceCents: 300, // only if Phase A + catalog still prove $3
         pricingVersion: "ppl_aged_beta_2026_08_v1",
       },
       authorization: {
         confirmed: true,
         ticket: "<ticket from step 3 of preconditions>",
         orderNumber: "LO-1060",
       },
       environment: "authorized_production",
     },
     prisma
   );
   ```

4. If the result is `eligible: false`, **stop**. Do not retry with guessed
   prices, coerced counts, or edited notes. Record the `code` and `reasons`.
5. If `alreadyRepaired: true` and `wrote: false`, **stop**. No further write.
6. If `wrote: true`, re-read `LO-1060`:
   - exactly one `LeadOrderLine` (`lineNumber = 1`)
   - bucket `COMMERCE_6_9_MO`, `unitPriceCents = 300`, qty 3
   - Stage 2b locks to that bucket
   - reserved / fulfilled / proposed remain the verified zeros
   - status and payment are unchanged
7. Unset `SA360_PORTAL_AGED_LINE_REPAIR_TICKET` immediately after the attempt
   (success or fail-closed).
8. Record the ticket, API SHA, evaluator/apply `code` / `reasons`, and the
   post-read line id.

### Hard stops

- Notes do not contain exactly one valid `requestedAgeBucket`.
- `$3` / `ppl_aged_beta_2026_08_v1` cannot be reconciled to the live notes and
  current catalog (`COMMERCE_6_9_MO` = 300 cents).
- Any count is unverified or non-zero.
- Any unrecognized or mismatched existing line.
- Status is not `submitted` / `ready` / `active`, or it drifted.
- `environment` is not `authorized_production` with a matching ticket env.

`environment: "local_test"` is allowed only against the local `sa360_test`
database. It must never be used with a production Prisma URL.

## Out of scope

- Repairing `LO-1060` from this PR, CI, or an unattended agent
- Repricing an approved/activated order
- Inferring the bucket from UI copy or a screenshot
- Changing production pricing
- Reserving inventory or changing payment
- Merging or deploying this PR as the repair itself
