# ADR: LF2 Channel-Neutral Fulfillment Shadow Core

Status: accepted (v1 shadow)

## Context

SA360 needs a durable, provider-neutral fulfillment core that connects trusted source leads to commercial orders and planned delivery instructions without performing live adapter execution.

## Decision

1. **`LeadOrder` is the commercial demand source of truth.** Allocation selects an active `LeadOrder`; legacy rows remain valid with nullable fulfillment fields and are not auto-activated by migration.
2. **`LeadAllocation` determines commercial ownership.** It references `SourceLeadEvent` + `LeadOrder` + `clientAccountId` only — no GHL location fields on the allocation record.
3. **Delivery is separate from allocation.** `DeliveryTarget` (client-configured adapter destination) and `DeliveryInstruction` (planned linkage) are distinct from `LeadAllocation`.
4. **GHL is one adapter.** Adapter resolution uses extensible `adapterKey` strings (`ghl.crm.v1`, `webhook.generic.v1`, etc.) via a registry — allocation/matcher logic has no GHL conditionals.
5. **Shadow allocation does not consume live order capacity.** Shadow allocations increment `proposedQuantity` only; `reservedQuantity` / `fulfilledQuantity` are untouched. Pay-per-lead remaining capacity in shadow mode subtracts only `reservedQuantity + fulfilledQuantity`, not `proposedQuantity`, so shadow proposals cannot permanently block evaluation while still recording intent for operators.
6. **The outbox is durable and replay-safe.** Accepted source leads get a durable outbox row with a unique idempotency key. Processor claims use conditional `updateMany` (compare-and-set) so only one worker processes a row; stale `processing` rows older than 15 minutes may be reclaimed.
7. **Intake-to-outbox is not yet fully transactional.** Source-lead acceptance paths may persist the lead before outbox insertion completes.
8. **Reconciliation currently compensates for missing outbox creation.** `POST /admin/v1/fulfillment-shadow/reconcile-outbox` backfills eligible source leads missing shadow outbox work using idempotent upsert — it does not create duplicate rows for the same idempotency key.
9. **Fully transactional intake/outbox insertion is required before broad automatic fulfillment.**
10. **`DeliveryAttempt`, atomic reservation, and live adapter execution are deferred** to the next phase (atomic reservation, provider-neutral `DeliveryAttempt`, one allowlisted GHL canary).

## Capacity semantics (v1 shadow)

| Field | Meaning in shadow v1 |
| --- | --- |
| `proposedQuantity` | Shadow matcher/planner intent counter; incremented once per unique shadow allocation |
| `reservedQuantity` | Live reservation only (unchanged in shadow) |
| `fulfilledQuantity` | Delivered leads (unchanged in shadow) |

PPL `remainingCapacity = requestedQuantity - reservedQuantity - fulfilledQuantity`. High `proposedQuantity` does not exclude an order from further shadow evaluation.

## Eligibility assessment history

Assessments are a **hybrid projection**: one row per `(sourceLeadEventId, policyKey, policyVersion)` unique key. Replays under the same policy version upsert deterministic processing metadata; a new policy version creates a separate row, preserving prior-version evidence for audit.

## Delivery target secrets

`DeliveryTarget.configMetadata` must store non-secret configuration and credential references only. Writes must reject nested secret-bearing keys (`token`, `secret`, `password`, `apiKey`, `authorization`, `credential`, `privateKey`, `oauth`, `bearer`, etc.). Admin presenters additionally redact legacy secret-like keys on read.

## Worker-to-API processing boundary

The worker invokes `POST /admin/v1/fulfillment-shadow/internal/process-outbox` with `ADMIN_API_KEY` rather than importing API services directly. This matches the existing bulk-import worker pattern, keeps package boundaries clean, and centralizes auth/logging in the API. A shared service package may be considered later if HTTP overhead or deployment coupling becomes costly.

## Transaction boundary note

Full single-transaction intake+outbox insertion is deferred where intake paths are already distributed. v1 provides:

- Replay-safe `upsert` outbox creation (`ensureFulfillmentOutboxForSourceLead`)
- `POST /admin/v1/fulfillment-shadow/reconcile-outbox` backfill for eligible source leads missing outbox work

## Policy versions

- Eligibility: `lf2_shadow_eligibility` / `1.0.0`
- Allocation: `1.0.0`
- Outbox work type: `shadow_fulfillment_v1`

## Deferred (explicitly out of scope for v1 shadow)

- Atomic reservation
- `DeliveryAttempt` records
- Live GHL / webhook / Sheets / CSV execution
- Automatic fulfillment activation
- Billing and replacements
