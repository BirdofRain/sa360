# ADR: LF2 Channel-Neutral Fulfillment Shadow Core

Status: accepted (v1 shadow)

## Context

SA360 needs a durable, provider-neutral fulfillment core that connects trusted source leads to commercial orders and planned delivery instructions without performing live adapter execution.

## Decision

1. **`LeadOrder` is the commercial demand source of truth.** Allocation selects an active `LeadOrder`; legacy rows remain valid with nullable fulfillment fields and are not auto-activated by migration.
2. **`LeadAllocation` determines commercial ownership.** It references `SourceLeadEvent` + `LeadOrder` + `clientAccountId` only — no GHL location fields on the allocation record.
3. **Delivery is separate from allocation.** `DeliveryTarget` (client-configured adapter destination) and `DeliveryInstruction` (planned linkage) are distinct from `LeadAllocation`.
4. **GHL is one adapter.** Adapter resolution uses extensible `adapterKey` strings (`ghl.crm.v1`, `webhook.generic.v1`, etc.) via a registry — allocation/matcher logic has no GHL conditionals.
5. **`FulfillmentOutbox` prevents lost work.** Accepted source leads get a durable outbox row with a unique idempotency key. Enqueue failures leave `pending` rows recoverable via reconciliation; processor claims are idempotent.
6. **Shadow mode does not consume sellable capacity.** Shadow allocations increment `proposedQuantity` only; `reservedQuantity` / `fulfilledQuantity` are untouched. No external CRM/webhook/file delivery occurs.
7. **Live reservation and adapter execution are deferred** to the next phase (atomic reservation, idempotent adapter attempts, one allowlisted GHL canary).

## Transaction boundary note

Full single-transaction intake+outbox insertion is deferred where intake paths are already distributed. v1 provides:

- Replay-safe `upsert` outbox creation (`ensureFulfillmentOutboxForSourceLead`)
- `POST /admin/v1/fulfillment-shadow/reconcile-outbox` backfill for eligible source leads missing outbox work

## Policy versions

- Eligibility: `lf2_shadow_eligibility` / `1.0.0`
- Allocation: `1.0.0`
- Outbox work type: `shadow_fulfillment_v1`
