# LO-1060 portal aged line repair — design only (do not apply)

This is an **idempotent, explicitly authorized** repair design for production
order `LO-1060`. It is **not** an apply run. Do not create a `LeadOrderLine`,
change status, reserve inventory, export, or reprice without a separate
operator authorization.

## Why a repair is needed

Customer-portal aged create previously persisted the requested commerce age
bucket only inside `notes` (`sa360.portalAgedOptions.v1`). Stage 2b / export
require a structured `LeadOrderLine` with `ppl_order_line_pricing_v1`.
`createClientLeadOrder()` now writes that line for **new** orders. `LO-1060`
was created before the fix.

## Phase A — required production read (operator)

Use existing authorized **read-only** production access. Do not use write
credentials. Confirm these fields against the live row — do not infer the
bucket from a screenshot alone.

| Check | Pass condition |
| --- | --- |
| `orderNumber` | `LO-1060` |
| Notes marker | notes contain exactly one `sa360.portalAgedOptions.v1` object |
| Requested bucket | `requestedAgeBucket === "COMMERCE_6_9_MO"` (catalog key, not the label) |
| Shortfall | `shortfallPolicy` is `REFUND_UNFILLED` or `ALLOW_OLDER_WITH_PRICE_ADJUSTMENT` |
| `LeadOrderLine` | none, or one line that already matches that bucket + qty + unit price |
| Pricing metadata | no conflicting `ppl_order_line_pricing_v1` snapshot |
| Status / payment / qty | unchanged from the original buyer decision (reported: approved/activated, payment not required, qty 3) |
| Buyer / niche / states | unchanged (`vet` / Veteran; CO, KS, CT, DE, FL, GA, HI, AZ) |
| Reservations | `reservedQuantity = 0`, no `LeadAllocation` in reserved/committed |
| Exports | no `LeadDeliveryExportPackage` |
| Receipts | no delivery receipts / buyer-delivered identities for this order |

This Cloud Agent environment has **no production admin key / doctl**. Read-only
probes on 2026-10-14:

- `GET https://sa360-sw6oq.ondigitalocean.app/health` → 200, `commitSha` `2e2a9e1`
  (the pre-fix production revision)
- `GET /admin/v1/lead-orders/LO-1060` without an admin key → 401 Unauthorized
- `GET /admin/v1/lead-orders?limit=1` without an admin key → 401 Unauthorized

No production row was read or written. The evaluator below is ready; a human
with read-only production access must fill the evidence table before any write
is authorized.

## Local evaluator (already in this PR)

`evaluatePortalAgedOrderLineRepair()` in
`apps/api/src/services/lead-order/portal-aged-commerce.ts` is read-only.

It is eligible only when:

1. Notes prove **exactly one** valid commerce age bucket.
2. Shortfall policy is present.
3. No conflicting priced line exists (a matching line is `alreadyRepaired`).
4. Reserved / fulfilled / proposed / committed / export / receipt counts are 0.
5. Original buyer, niche, states, quantity, and payment decision still match.
6. Current catalog unit price matches `expectedUnitPriceCents` when supplied.

Fail-closed codes:

- `notes_request_incomplete` — missing/ambiguous notes; do not use a screenshot
- `conflicting_priced_order_line` — an existing line disagrees
- `fulfillment_already_started` — inventory already touched
- `original_request_changed` — buyer/niche/state/qty/payment drifted
- `original_price_unrecoverable` — catalog no longer matches the confirmed quote
- `priced_line_unavailable` — catalog cannot price the verified bucket

## Safe apply procedure (authorized operator only)

Do **not** run this against production from this PR.

1. Re-read `LO-1060` and related allocation/export/receipt counts.
2. Run `evaluatePortalAgedOrderLineRepair()` with the live evidence and
   `expectedUnitPriceCents: 300` **only if** notes prove `COMMERCE_6_9_MO` and
   the original confirmation was $3 / lead.
3. If `eligible: false` and `code === "original_price_unrecoverable"`, stop and
   ask the operator to confirm the historical unit price. Do not guess.
4. If `alreadyRepaired: true`, stop. No write.
5. If `eligible: true` and `alreadyRepaired: false`, in **one transaction**:
   - create `LeadOrderLine` from `decision.line.data` via the existing
     `buildPplOrderLineCreateData()` snapshot (do not hand-edit prices)
   - if `orderKind` / `fulfillmentMode` / `requestedQuantity` are still null,
     set `pay_per_lead` / `pooled_matching` / `leadVolume` only
   - do not change status, payment, notes, buyer, niche, states, or quantity
6. Re-read the order. Confirm Stage 2b locks to `COMMERCE_6_9_MO` at 300 cents
   and that reserved/fulfilled remain 0.
7. Record the authorization ticket and the evaluator `reasons`.

## Blocker if notes cannot be verified

If production notes do not contain a single valid `requestedAgeBucket`, or the
$3 unit price cannot be reconciled to the current
`ppl_aged_beta_2026_08_v1` catalog (`COMMERCE_6_9_MO` = 300 cents), **do not
repair**. Operator confirmation is required.

## Out of scope

- Repricing an approved/activated order
- Inferring the bucket from UI copy or a screenshot
- Applying this repair from CI or an unattended agent
- Changing production pricing
