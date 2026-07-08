# ADR: LF2 Atomic Reservation and DeliveryAttempt Foundation (PR A)

Status: accepted (v1 execution foundation, simulation-only)

## Context

LF2 shadow core records commercial intent without consuming live capacity or executing adapters. Phase 2 PR A adds atomic reservation, provider-neutral `DeliveryAttempt` audit rows, and simulation-only orchestration without live external writes.

## Decision

1. **Allocation lifecycle extended:** `shadow` → `reserved` → `delivering` → `committed` | `released` | `review_required`.
2. **Reservation is manual and admin-only.** No intake outbox work type, no shadow processor auto-promotion.
3. **Atomic reservation** uses conditional PostgreSQL updates inside a serializable transaction:
   - `LeadAllocation` `shadow` → `reserved` only when status matches
   - `LeadOrder.reservedQuantity` increments only when `reservedQuantity + fulfilledQuantity < requestedQuantity`
4. **Exclusive source lead protection** enforced via partial unique index on `LeadAllocation(sourceLeadEventId)` where status ∈ `{reserved, delivering, committed, review_required}`.
5. **`DeliveryAttempt` is immutable history.** Retries create new rows with monotonically increasing `attemptNumber`. Prior failure evidence is never overwritten.
6. **Active attempt claim** enforced via partial unique index on `DeliveryAttempt(deliveryInstructionId)` where status ∈ `{claimed, in_progress}`.
7. **Network boundary:** DB transactions never wrap adapter calls. Claim (Transaction A) → external/simulated execution → result recording (Transaction B).
8. **`unknown_outcome`** holds reservation, sets allocation `review_required`, blocks automatic retry.
9. **Simulation-only in PR A:** `test.simulated.v1` adapter registered; `ghl.crm.v1` live execution deferred to PR B.
10. **Counter reconciliation** reports drift only; no silent auto-repair in PR A.

## Capacity invariants

- `reservedQuantity >= 0`, `fulfilledQuantity >= 0`
- `reservedQuantity + fulfilledQuantity <= requestedQuantity`
- `proposedQuantity` is observational only

## Crash windows (documented)

| Window | State | Recovery |
| --- | --- | --- |
| After reservation tx, before attempt claim | `reserved` | Manual release or attempt claim |
| After claim tx, before external call | `delivering`, attempt `claimed`/`in_progress` | Reclaim stale attempt or operator review |
| After external call, before result tx | May be `unknown_outcome` | Operator reconciliation; no auto-retry |
| After success tx partial failure | Counter/allocation mismatch | Counter reconciliation report |

## Deferred to PR B

- `ghl.crm.v1` executable adapter
- LF2 deny-by-default allowlists
- Manual GHL canary endpoint
- Live HTTP writes
