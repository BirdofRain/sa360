# Fulfillment Operations Workbench

> **LOCAL DEMO ONLY**
>
> The repository root `.env` may point to a remote DigitalOcean database.
> Do **not** run the fulfillment workbench seed or rehearsal using the root
> `DATABASE_URL`. Explicitly override `DATABASE_URL` with the local Docker
> Postgres URL before running any migration, seed, import or rehearsal command.
>
> The local seed and inspection scripts refuse non-localhost databases.

Internal Admin C.O.C. operator path that stitches existing SA360 fulfillment capabilities for a safe demonstration.

## Purpose

Prove that SA360 can consolidate the manual fulfillment workflow currently spread across spreadsheets, inventory sorting, order management, and delivery verification — **without** enabling live delivery, billing, returns, or a customer marketplace.

## Route

- Admin C.O.C.: `/fulfillment-ops`
- Nav label: **Fulfillment Ops**

## Local startup environment (no secrets committed)

Use local Docker Postgres only:

```text
DATABASE_URL=postgresql://sa360:<local-password>@localhost:5432/sa360
API URL=http://localhost:3000
Admin C.O.C.=http://localhost:3001
SA360_LEAD_INVENTORY_REVIEW_ENABLED=true
SA360_LF2_EXECUTION_ENABLED=false
SA360_LF2_GHL_CANARY_ENABLED=false
```

Leave all `SA360_LF2_GHL_ALLOWED_*` values unset. Prefer Admin on port **3001** so it does not collide with the API on **3000**.

### Hard requirements for the Friday rehearsal

- Local Docker database only — never the repository root remote `DATABASE_URL`
- Simulation only — live attempts must remain **zero**
- Inventory review enabled **locally only** (`SA360_LEAD_INVENTORY_REVIEW_ENABLED=true`)
- Synthetic seed is **required after import** for the deterministic rehearsal (proof + UNIQUE)
- Returns, billing, credits and customer self-service are **not** implemented
- Inventory Explorer remains separate and fixture-backed

## Canonical models / services reused

| Layer | Models | Services / APIs |
| --- | --- | --- |
| Supply | `InventoryLot`, `LeadInventoryItem`, import/review audit | `/admin/v1/lead-inventory/*` |
| Demand | `LeadOrder` (+ LF2 fields) | `/admin/v1/lead-orders`, workbench demo-order helper |
| Eligibility | `LeadEligibilityAssessment` | LF2 eligibility evaluator + workbench order preview |
| Allocation | `LeadAllocation`, `DeliveryInstruction` | workbench prepare (shadow bind) + canonical reserve |
| Simulation | `DeliveryAttempt` (`executionMode=simulation`) | workbench simulate → LF2 simulate (`test.simulated.v1`) |
| Proof | `LeadProof`, `LeadVerificationResult` | existing fail-closed eligibility gates |

Thin orchestration surface (not a second backend):

- `/admin/v1/fulfillment-ops/*`

## Feature flags

| Flag | Expected safe state for Friday demo |
| --- | --- |
| `SA360_LEAD_INVENTORY_REVIEW_ENABLED` | **Optional opt-in** in demo env only (activation commits). Default off is safe; workbench shows blocked state. |
| `SA360_LF2_EXECUTION_ENABLED` | **OFF** / `false` |
| `SA360_LF2_GHL_CANARY_ENABLED` | **OFF** / `false` |
| `SA360_LF2_GHL_ALLOWED_CLIENT_IDS` | unset / empty |
| `SA360_LF2_GHL_ALLOWED_LOCATION_IDS` | unset / empty |
| `SA360_LF2_GHL_ALLOWED_ORDER_IDS` | unset / empty |
| `SA360_LF2_GHL_ALLOWED_SOURCE_LANES` | unset / empty |

The workbench always displays **SIMULATION ONLY** / **LIVE DISABLED** and never calls LF2 GHL live canary execute endpoints.

## Local deterministic dataset (rehearsal)

- CSV: `docs/demo/inventory/fulfillment-ops-workbench-nc-vet.csv` (2 synthetic NC `vet` rows: `FOWB-001`, `FOWB-002`)
- Synthetic contacts only: `@example.test` emails and `+1555…` phones
- Client: `client_fowb_demo_local`
- Local seed (proof + UNIQUE verification only; refuses non-localhost `DATABASE_URL`):
  - `apps/api/src/scripts/fulfillment-ops-workbench-local-seed.ts`
- Optional sanitized inspect (also localhost-guarded; requires `FOWB_ORDER_ID` / `FOWB_ALLOC_ID`):
  - `apps/api/src/scripts/fulfillment-ops-workbench-local-db-inspect.ts`
- Confirmations:
  - Import: `IMPORT ONE AGED LEAD INVENTORY BATCH`
  - Make available: `MAKE REVIEWED INVENTORY AVAILABLE`

## Demo sequence

1. Open `/fulfillment-ops` and confirm live badges show disabled.
2. Use **Lead Inventory** (deep link) to import the FOWB CSV and run review/activation when the review flag is enabled. The workbench stitches the workflow but does **not** replace that page.
3. Run the local seed script so synthetic leads have `PROOF_ATTACHED` + `PASSED`/`UNIQUE` (no live GHL duplicate search).
4. Select an existing `LeadOrder` or create a demo order (sets `pay_per_lead` + `pooled_matching` + `requestedQuantity`). Prefer niche `vet`, state `NC`, qty `2`.
5. Activate the order.
6. Run eligibility preview (available inventory filtered by niche/states).
7. Select an eligible candidate.
8. **Prepare + reserve** (explicit click).
9. **Run simulated delivery** (explicit click; `test.simulated.v1` only).
10. Confirm attempt history, counters, and **live attempts = 0**.
11. Refresh with `?orderId=…`; bootstrap/`latest-evidence` restores reservation + simulation evidence from the backend.

## Simulation-only boundary

- Reservation and simulation are never automatic on page load.
- Simulation adapter key: `test.simulated.v1`.
- No live GHL writes, webhook delivery, Sheets adapter execution, or worker cutover.
- Safety copy: `Simulation only — no external delivery will occur.`
- Responses must keep `externalWriteOccurred=false` when no live attempt exists.

## Known limitations (intentionally out of scope)

1. CSV import and review remain on the canonical Lead Inventory page.
2. The workbench stitches the workflow but does not replace that page.
3. Current matching is not inventory-SKU-aware (niche/state filters + operator selection).
4. An already-reserved item may still appear as inventory `available` in eligibility results.
5. Repeated simulation creates additional simulation attempts (still live=0).
6. `Runtime: unknown` in the safety banner is cosmetic.
7. No returns, replacements, billing, credits or marketplace are included.
8. No live external delivery is enabled.

Also out of scope:

- Billing / revenue reconciliation / Stripe
- Durable prepaid credit ledger / pricing
- Live Inventory Explorer data (FO fixture at `/front-office/pipeline-studio` remains separate)
- Customer-facing marketplace / self-service checkout
- Mixing with legacy `LeadDeliveryPlan` / routing-dry-run GHL canary paths

## Domain boundaries to preserve

- **Inventory Explorer** (FO fixture) ≠ **Lead Inventory** (canonical)
- **LeadDeliveryPlan** (legacy) ≠ **DeliveryInstruction / DeliveryAttempt** (LF2)
- Aged inventory import ≠ bulk source-lead intake
