# Buyer-specific inventory availability

Read-only admin lookup for “how many aged leads can this buyer actually take?”
Example: JR Laird / trucker / GA / all aged tiers. A blank or omitted state
list on this admin lookup means every canonical US state (All states). The
customer portal map still sends the full state list and still rejects a
partial list. Order creation, selection preview, and commit still require
states.

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

## Counts and snapshot

Structural counts and the classification scan run in one `REPEATABLE READ`,
`READ ONLY` transaction. PostgreSQL read committed gives each statement its own
snapshot, so parallel counts plus later keyset pages cannot be called exact:
an insert and a status change can net to the same row count while the scanned
set is a different cohort. If the transaction cannot start, the route returns
503 `availability_snapshot_unavailable` and does not invent a count.

`snapshot.consistent: true` means the numbers describe the snapshot at
transaction start. Writes that commit after that — inserts, reservations,
status changes, source-association updates — are invisible to this check.
Exact structural counts and exact eligible tier counts are exact for that
snapshot. The 100,000-row figure is one classification pass. The same
repeatable-read transaction continues from the keyset cursor, keeping phone
and email dedupe state, until the selectable cohort is exhausted. A finished
count can therefore classify more than 100,000 rows and is still exact for
`evaluatedAt`. Tiers the oldest-first cursor has not entered are
`not_reached` (`eligible: null`) rather than zero. An all-states lookup uses
the same passes. If a pass is interrupted, `stateScope` is still `all`, the
summary says the figure is not a nationwide total, and unscanned states stay
`not_reached` rather than zero. The snapshot transaction budget is 300
seconds. If that budget is exhausted the route returns 503 and does not
return a partial total. `eligibleByState` uses the
same eligible rows, after identity dedupe. For `stateScope: "all"` that list
is every canonical US state code. The portal map sends one of the five
priced ranges, so a state's count is only that range. A historical 6–12 admin
request still sums unique consumers across 6–9 and 9–12. A state with eligible
rows on an incomplete scan is a lower bound. A state with no eligible rows yet
is `not_reached` (`eligible: null`), not zero. Zero is exact only when the scan
finishes. The response records
`usesSelectionRowCap: false` so a 5,000-row selection ceiling cannot be read as
the availability total.

The lookup holds one pooled connection for the snapshot (timeout 300 seconds,
max wait 10 seconds). A second nationwide count needs another connection from
the same Prisma pool. Prisma’s default pool is `num_physical_cpus * 2 + 1`
per API process unless `DATABASE_URL` sets `connection_limit`. Production
`sa360-api` is one 1 vCPU instance and its `DATABASE_URL` does not set
`connection_limit`, so that pool is 3 connections. The worker process has its
own pool. When every
connection is busy, the next count waits up to 10 seconds and then returns
503 `availability_snapshot_unavailable` instead of a total. Client disconnect
aborts the snapshot at the next page, the read-only transaction ends, and
Prisma returns the connection. The admin panel’s server route forwards the
browser abort to that API request, so an edge cutoff releases the same
connection. The portal route uses the same disconnect abort. Success, a thrown snapshot error, and the
300-second transaction timeout do the same. App Platform fronts this route
with Cloudflare, whose request limit is 100 seconds, so a measured 78-second
count fits. A count that is still running at that edge limit is cut off; the
panel tells the operator to wait and check again, and it does not show a
total. Each page
keysets 250 item ids, then loads payloads only for that page. The
source-association cache is per request and is consistent because the snapshot
does not change. A null-origin LeadCapture gate uses
`LeadInventoryItem.sourceProvider`, and reconciliation rechecks the event
provider before a funnel can match.

Open allocations are a stricter predicate than selection preview. Selection SQL
keeps `status = available` rows until reservation flips the status. This lookup
also excludes `shadow`, `reserved`, `delivering`, `committed`, and
`review_required` allocations. Released allocations stay eligible. Candidate
order matches selection: `generatedAt` ascending, then `id` ascending, with
oldest-first phone/email dedupe.

The response contains aggregate counts, the buyer account id, and the buyer
display name. It does not return lead payloads, phones, emails, or names.

## Flag-off deployment and rollback

Deploy this code with `SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED` unset or any
value other than `true`. The admin route then returns 404
`buyer_inventory_availability_disabled`. The Fulfillment Operations page shows
the disabled explanation and does not call the lookup. Do not set the flag as
part of the deploy.

Rollback is a code revert. There is no migration and no data write. Unsetting
the flag, or leaving it unset, disables the route even if the code stays
deployed. Observers are not on the fulfillment-ops allowlist: the page, the
BFF `POST`, and the admin API path are denied for `SA360_OBSERVER`. The API
itself still requires `x-sa360-admin-key`.
