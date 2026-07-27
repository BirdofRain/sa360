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

## PR #44 scope (control-spine foundation)

**PR #44 is the internal control-spine foundation, not the full mid-August beta.**

It proves that operators can run a simulation-only path over existing Lead Inventory + LF2 reservation/simulation APIs:

- inventory import / review deep-link
- order select/create + activate
- eligibility preview
- prepare + internal reserve
- simulated delivery (`test.simulated.v1`)
- persisted operational evidence with `liveAttemptCount = 0`

It does **not** implement buyer spreadsheet delivery, buyer-specific dedupe, protected-agent exclusions, exact-quantity selection UX, canonical age-bucket commerce rules, replacement handling, pricing checkout, GHL delivery, billing automation, or public self-service.

## Confirmed mid-August beta direction (product context)

Approved business direction for the next beta layers (documented here so PR #44 stays aligned; **not implemented in this PR**):

| Topic | Confirmed direction |
| --- | --- |
| Existing retainers | Continue under the current model |
| New fulfillment focus | Paid-per-lead aged inventory |
| First prospective buyer | Vanessa Powell |
| First delivery method | Spreadsheet / Google Sheets |
| Initial niches | Veteran and Trucker |
| Initial states | NC, TX, NJ, CA |
| Age buckets | 1–3 months · 3–6 months · 6–12 months · 12+ months |
| Inventory allocation | First come, first served |
| Customer advance reservation | **No** — no advance customer reservation or state requests |
| Internal reservation | **Required** — atomic reservation to prevent duplicate sale |
| Quantity | Deliver **exactly** the purchased quantity (no extra-lead buffer) |
| Replacements | Duplicate-only replacements for the first beta |
| Outcome reporting | Optional |
| Pricing | 100–199 → $42/lead · 200–399 → $40/lead · 400+ → $38/lead |
| Orders under 100 | **Unresolved** — must **not** be hard-coded in PR #44 |
| Quality | Evaluated internally; **not** shown as a public score |
| Deferred | Fresh leads, billing automation, public checkout, GHL delivery, advanced outcome reporting |

Buyer name and pricing above are product context for roadmap planning only. They are **not** encoded as authorization, allowlists, or checkout rules in this PR.

## Next missing layers (after PR #44)

These remain out of scope for the control-spine foundation and must land in follow-on work before mid-August beta readiness:

1. **Buyer-specific prior-delivery deduplication** — do not resell leads previously delivered to the same buyer.
2. **Protected-agent exclusions** — keep protected-agent inventory out of sellable fulfillment sets.
3. **Exact-quantity inventory selection** — select and reserve exactly the purchased quantity with no buffer.
4. **Canonical age buckets** — commerce/filter semantics for 1–3 / 3–6 / 6–12 / 12+ months.
5. **Buyer-safe spreadsheet generation** — Google Sheets / spreadsheet delivery package without exposing internal-only fields.
6. **Duplicate-only replacement handling** — first-beta replacement policy limited to duplicates.

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

### Hard requirements for local rehearsal

- Local Docker database only — never the repository root remote `DATABASE_URL`
- Simulation only — live attempts must remain **zero**
- Inventory review enabled **locally only** (`SA360_LEAD_INVENTORY_REVIEW_ENABLED=true`)
- Synthetic seed is **required after import** for the deterministic rehearsal (proof + UNIQUE)
- Returns, billing, credits and customer self-service are **not** implemented
- Inventory Explorer remains separate and fixture-backed
- No Google Sheets, GHL, webhook, or CRM external writes from this workbench

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

| Flag | Expected safe state for local demo |
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

## Known limitations (intentionally out of scope for PR #44)

1. CSV import and review remain on the canonical Lead Inventory page.
2. The workbench stitches the workflow but does not replace that page.
3. Current matching is not inventory-SKU-aware (niche/state filters + operator selection).
4. An already-reserved item may still appear as inventory `available` in eligibility results.
5. Repeated simulation creates additional simulation attempts (still live=0).
6. `Runtime: unknown` in the safety banner is cosmetic.
7. No returns, replacements, billing, credits or marketplace are included.
8. No live external delivery is enabled.
9. Mid-August beta layers listed above (buyer dedupe, protected-agent exclusions, exact quantity, age buckets, spreadsheet package, duplicate-only replacements) are **not** implemented here.
10. Pricing tiers and under-100 order policy are **not** hard-coded in this PR.

Also out of scope:

- Billing / revenue reconciliation / Stripe
- Durable prepaid credit ledger / pricing checkout
- Live Inventory Explorer data (FO fixture at `/front-office/pipeline-studio` remains separate)
- Customer-facing marketplace / self-service checkout
- Mixing with legacy `LeadDeliveryPlan` / routing-dry-run GHL canary paths

## Domain boundaries to preserve

- **Inventory Explorer** (FO fixture) ≠ **Lead Inventory** (canonical)
- **LeadDeliveryPlan** (legacy) ≠ **DeliveryInstruction / DeliveryAttempt** (LF2)
- Aged inventory import ≠ bulk source-lead intake
- **PR #44 control spine** ≠ **mid-August buyer delivery beta**
