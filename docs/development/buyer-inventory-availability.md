# Buyer-specific inventory availability

Read-only admin lookup for “how many aged leads can this buyer actually take?”
Example: JR Laird / trucker / GA / all aged tiers.

Feature flag `SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED` defaults off. The HTTP
route is `POST /admin/v1/fulfillment-ops/buyer-availability` and returns 404
until the flag is exactly `true`. The lookup does not create orders,
reservations, deliveries, or CSV files, and it does not mutate source data.

## What the existing surfaces count

| Surface | What it answers | Buyer-specific? | Origin | Cap |
| --- | --- | --- | --- | --- |
| Inventory Explorer (`/front-office/pipeline-studio`) | Fixture geography snapshot | No | No | Fixture |
| Leads on Demand | Proof/verification availability labels by niche, state, and age band | Client filter only | No | Loads the matching corpus |
| Fulfillment Ops selection preview | Canonical PPL eligibility for one existing order | Yes, from the order | Persisted stamp only. Null origin stays eligible | Stops at requested quantity or 5,000 scanned rows |

Selection preview’s `eligibleQuantity` is the number of candidates collected in
that window. Hitting the 5,000-row ceiling is an incomplete search, not a
catalog total.

Canonical selection already applies buyer-ready quality, exact commerce age
windows, `available` plus active lot, commerce exclusion, protected-agent
rules, `BuyerDeliveredIdentity` plus applied external-receipt fingerprints, and
in-result phone/email dedupe. Origin exclusion runs before dedupe, so a
same-origin row does not consume the identity of a cross-client copy.
`isOriginClientBuyerIneligible` still treats a blank stamp as eligible. This
lookup does not change that selection contract.

## Ownership rule for this lookup

A lead is buyer-eligible on origin only when ownership is confirmed and is not
the buyer:

- Persisted `LeadInventoryItem.originClientAccountId` wins. The live funnel is
  not allowed to override a stamp.
- A null stamp is reconciled only through
  `resolveConfirmedLeadCaptureSourceAssociation` (confirmed LeadCapture source
  funnel / parent URL). Suggestions, ambiguous slugs, and unconfirmed rows do
  not match.
- Any other missing origin, including non-LeadCapture inventory, is
  `provider_not_reconcilable` or another unresolved reason. It is reported and
  is not counted as eligible.

Stamped same-origin rows and non-reconcilable null stamps are counted in SQL
and their payloads are not loaded. Payload classification is reserved for
stamped other-origin rows and unstamped LeadCapture rows that might reconcile.

## Counts

Structural cohort counts (status, commerce exclusion, open allocations,
stamped origin) are exact. Eligible counts by commerce age tier are exact only
when every selectable row was classified. Otherwise the report is
`queryCompleteness: incomplete`, eligible numbers are lower bounds, and tiers
the oldest-first cursor has not entered are `not_reached` (`eligible: null`)
rather than zero. The response records `usesSelectionRowCap: false` so a
5,000-row selection ceiling cannot be read as the availability total.

The response contains aggregate counts, the buyer account id, and the buyer
display name. It does not return lead payloads, phones, emails, or names.
