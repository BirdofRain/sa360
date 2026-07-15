# Lead inventory domain

## Purpose

Lead Inventory Foundation v1 introduces a durable **supply** domain separate from intake events, compliance evidence, buyer demand, and GHL delivery.

It supports Life Agent Launch (LAL) fresh leads today and is designed for future LeadCapture inventory, aged CSV imports, purchased inventory, and multi-vendor expansion — without building a marketplace or payment flow in v1.

## Domain boundaries

| Concept | Role | Mutated by inventory v1? |
| --- | --- | --- |
| `SourceLeadEvent` | Intake/event record | No (read for preview only) |
| `LeadInventoryItem` | Commercially usable supply unit | Schema only — no production rows in v1 |
| `InventoryLot` | Batch/campaign/import/generation source | Schema only |
| `LeadProof` / `LeadVerificationResult` | Compliance/readiness evidence | Read-only inputs to availability |
| `LeadOrder` / `LeadOrderLine` | Buyer demand | `LeadOrderLine` added; existing order APIs unchanged |
| `LeadAllocation` | Demand-to-supply link | Nullable `leadOrderLineId` / `leadInventoryItemId` added |
| `DeliveryInstruction` / `DeliveryAttempt` | Delivery execution | Unchanged |
| GHL / CRM lifecycle | Delivery destination state | Separate from inventory status |

## Reuse from LF2

**Reused unchanged**

- `SourceLeadEvent` intake model
- `LeadProof`, `LeadProofArtifact`, `LeadVerificationResult`
- `LeadOrder` endpoints and flat order presentation
- `LeadAllocation` status semantics (`shadow`, `reserved`, `committed`, …)
- LF2 shadow/reservation/execution services
- Proof requirement policies and eligibility evaluator (import preview readiness)

**Additive extensions**

- `InventoryLot`, `LeadInventoryItem`, `LeadAgeBandDefinition`, `LeadOrderLine`
- Nullable allocation links for future exact item matching
- Read-only admin inventory APIs and UI matrix
- Client-safe aggregate Leads on Demand availability catalog
- Import preview (no writes)

**Must remain separate**

- Inventory availability status (not CRM lifecycle)
- Aggregate client availability (no item IDs / PII)
- Supply records (no duplicated contact PII on `LeadInventoryItem`)

## Current LeadOrder limitations

- Orders are **flat documents** without line items in production data
- LF2 capacity uses order-level `requestedQuantity` and counters
- Shadow matcher binds one `LeadOrder` per allocation — no per-line age/state SKU matching yet
- `LeadOrderLine` enables future state/age/class demand but v1 does not backfill lines automatically

## Current LeadAllocation limitations

- No `leadInventoryItemId` populated on existing rows (nullable additive columns only)
- Reservation still operates on allocation + order counters, not inventory item state transitions
- Future work: reserved inventory item linkage and line-aware matching

## Authoritative age

- `generatedAt` on `LeadInventoryItem` is the **only** authoritative age timestamp
- `receivedAt` on `SourceLeadEvent` is **not** a silent substitute (import preview enforces this)
- `ageDays = floor((evaluationTime - generatedAt) / 1 day)` in UTC
- `ageBandKey` is derived per evaluation from `LeadAgeBandDefinition` — not stored as frozen truth on the item

## State normalization

- `normalizedState` is required on inventory items
- Normalization maps US state names to codes when possible; otherwise trimmed label
- Availability fails closed when state is missing

## Inventory status vs CRM status

Inventory item status (`available`, `reserved`, `committed`, …) describes **supply ownership and fulfillment readiness**, not GHL pipeline stages.

## Derived availability

Canonical evaluator inputs:

- item + lot status
- `generatedAt`, `normalizedState`
- proof + verification readiness
- active reservations / fulfillment limits
- explicit `evaluatedAt`

Explicit blockers include: `lot_not_active`, `item_not_available`, `proof_not_ready`, `verification_not_passed`, `duplicate_risk`, `active_reservation`, `quarantined`, `expired`, `withdrawn`, etc.

Incomplete evidence is never silently treated as available.

## Demand overlay

Active `LeadOrderLine` rows contribute **requested** quantity by state/age band. Supply counts come from inventory items. The facet matrix exposes `demand`, `supply`, `reserved`, `unmet`, and `coverageRatio` without auto-matching.

## Privacy boundary

Aggregate and list APIs return masked identifiers only. No names, phones, emails, addresses, consent text, IP, user-agent, raw payloads, or full lead UIDs in client responses.

## Rollback / disable

- v1 is read-only: disable admin UI route `/lead-inventory` and client `/front-office/leads-on-demand` in admin-coc navigation if needed
- No fulfillment hooks are enabled by this PR
- Schema is additive; rollback is a forward migration plan if ever required

## Future paths

- Aged lead CSV import → `InventoryLot` + `LeadInventoryItem` creation (authorized separately)
- LeadCapture inventory once Data API is healthy
- Purchasing/pricing/checkout (not in v1)
- Multi-vendor lots with `supplierAccountId` and `sourceLane` filters
- Line-aware allocation matching against `LeadOrderLine` constraints

## Migration dependency (PR #38)

Production already contains `20260714180000_leadcapture_trust_sync_audit_v1` from the parked LeadCapture PR. This branch adds `20260715120000_lead_inventory_foundation_v1` on master (49 → 50 local migrations). **Do not merge or deploy** until PR #38 is merged and this branch is rebased, then full migration validation is re-run (expected 50 migrations on rebased master).
