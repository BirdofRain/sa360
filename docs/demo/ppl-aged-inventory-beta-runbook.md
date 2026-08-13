# PPL Aged Inventory Beta — Operator Runbook (Alex CSV Export)

Controlled beta: **manual spreadsheet delivery only**. No live GHL / Sheets API / webhook / CRM write path.

> Do **not** hard-code buyer display names into domain logic or authorization. Represent the buyer only via a canonical `clientAccountId`.

---

## Current beta behavior (read this first)

| Rule | Current value |
|---|---|
| Minimum requested quantity | **1** |
| Partial fulfillment | Allowed only when candidate search **exhausts matching inventory** |
| Scan limit (`MAX_SELECTION_SCANNED_ROWS = 5000`) | If hit before requested qty is verified → `scan_limit_reached` (not a shortage). Preview incomplete; **commit does not reserve**. |
| Delivery boundary | CSV download ≠ delivered. Only **MARK SPREADSHEET DELIVERED** writes `BuyerDeliveredIdentity`. |
| External writes | None on this path (`externalWriteOccurred` must stay false) |
| PPL flags | Default **off** unless exactly `"true"` |
| Under-30-day inventory | Outside aged PPL beta |
| Commercial CSV schema (new exports) | **`buyer_csv_v2`** |
| Historical packages | **`buyer_csv_v1`** remains downloadable unchanged |
| Pricing version | `ppl_aged_beta_2026_08_v1` |
| Buckets per priced order | **Exactly one** commerce age bucket |

### Commercial age buckets + aged pricing

| Key | Label | Age (days) | Unit price |
|---|---|---|---|
| `COMMERCE_1_3_MO` | 1–3 months | 30–&lt;90 | **$6.00** (600¢) |
| `COMMERCE_3_6_MO` | 3–6 months | 90–&lt;180 | **$4.00** (400¢) |
| `COMMERCE_6_9_MO` | 6–9 months | 180–&lt;270 | **$3.00** (300¢) |
| `COMMERCE_9_12_MO` | 9–12 months | 270–&lt;365 | **$2.00** (200¢) |
| `COMMERCE_12_MO_PLUS` | 12+ months | 365+ | **$1.00** (100¢) |

Legacy request key `COMMERCE_6_12_MO` is still accepted for **unpriced/legacy** matching (expands to 180–&lt;365) but is **not** used for new priced Client Lead Orders.

### Fresh / Semi-Fresh — HOLD / TBD

| Key | Age (days) | Status | Working target |
|---|---|---|---|
| `FRESH` | 0–9 | **HOLD / TBD** | $15 / lead |
| `SEMI_FRESH` | 10–29 | **HOLD / TBD** | $12 / lead |

These are **not** selectable Alex aged-PPL products. Under-30 inventory is not routed into aged selection. Aaron: depends on actual acquisition cost.

### Buyer CSV contract

#### Historical `buyer_csv_v1` (immutable packages)

1. `first_name` 2. `last_name` 3. `phone` 4. `email` 5. `state` 6. `lead_date` 7. `niche`

#### New exports `buyer_csv_v2`

Base columns (every niche):

1. `first_name` 2. `last_name` 3. `phone` 4. `email` 5. `state` 6. `lead_date` 7. `niche` 8. `beneficiary` 9. `coverage_amount`

Niche append (allowlist only):

| Niche | Extra columns |
|---|---|
| VET | `branch_of_service`, `disability_rating` |
| TRUCKER | `rig_type`, `company_or_independent` |
| NURSE | `healthcare_profession`, `primary_concern` |
| MORTGAGE | `homeowner`, `house_type` |
| Unknown / other | base only |

**Optional sales-context fields never affect eligibility, selection, reservation, or export.** Blank cells only when unavailable. Mixed-niche allocations in one export fail safely.

Canonical storage preference:

```json
{
  "contact": { "first_name": "...", "last_name": "...", "phone_e164": "...", "email": "...", "state": "..." },
  "lead_details": {
    "beneficiary": "...",
    "coverage_amount": "...",
    "niche": { "branch_of_service": "..." }
  }
}
```

Exporter also reads historical flat / `sourceAttributes` via an explicit alias registry (no production backfill required).

---

## 1. Safety gates (must remain true before / after deploy)

- [ ] `SA360_PPL_SELECTION_ENABLED` unset or not `"true"` until launch window
- [ ] `SA360_PPL_CSV_EXPORT_ENABLED` unset or not `"true"` until launch window
- [ ] `SA360_PPL_REPLACEMENT_ENABLED` unset or not `"true"` until launch window
- [ ] `SA360_LF2_EXECUTION_ENABLED=false` or unset
- [ ] `SA360_LF2_GHL_CANARY_ENABLED=false` or unset
- [ ] All `SA360_LF2_GHL_ALLOWED_*` **unset**
- [ ] Snapshot READ / SHADOW / REBUILD not activated for this beta
- [ ] Meta delivery not activated
- [ ] No Google Sheets API / GHL / webhook / email / CRM live write for this beta
- [ ] Buyer delivery = download CSV + **manual** spreadsheet import only

---

## 2. Environment checklist (sanitized)

| Variable | Beta expectation | Notes |
|---|---|---|
| `DATABASE_URL` | Deployed Postgres URL | Never commit |
| `SA360_ADMIN_API_KEY` (or `ADMIN_API_KEY`) | Set for Admin→API auth | Do not log |
| `NEXT_PUBLIC_SA360_API_BASE_URL` | Admin API base | Public URL only |
| `SA360_PPL_SELECTION_ENABLED` | `"true"` only in controlled window | Default off |
| `SA360_PPL_CSV_EXPORT_ENABLED` | `"true"` only in controlled window | Default off |
| `SA360_PPL_REPLACEMENT_ENABLED` | `"true"` only in controlled window | Default off |
| `SA360_LF2_EXECUTION_ENABLED` | `false` / unset | Live LF2 off |
| `SA360_LF2_GHL_CANARY_ENABLED` | `false` / unset | GHL canary off |
| `SA360_LF2_GHL_ALLOWED_*` | **unset** | Empty deny |

### Local / CI test database (developers)

Automated Prisma tests **must not** use root `.env` `DATABASE_URL`.

| Variable | Purpose |
|---|---|
| `SA360_TEST_DATABASE_URL` | **Only** authorized DB target for `pnpm --filter @sa360/api test` |

Requirements:

- Host allowlist: `localhost`, `127.0.0.1`, or `::1`
- Database name must contain `test` (example: `sa360_test`)
- Remote hosts (including `*.db.ondigitalocean.com`) are rejected

```powershell
$env:SA360_TEST_DATABASE_URL = "postgresql://sa360:<local-compose-password>@127.0.0.1:5432/sa360_test"
$env:DATABASE_URL = $env:SA360_TEST_DATABASE_URL
pnpm exec prisma migrate deploy
```

Optional concurrency suites also accept `SA360_PPL_INTEGRATION_DATABASE_URL` (same localhost + test-name rules).

---

## 3. First-order configuration worksheet

```text
=== PPL AGED BETA — ORDER CONFIG (operator confirmation required) ===

Internal order reference:     __________________
Operator (Alex):              __________________
Date prepared:                __________________

--- Buyer (canonical account; do not authorize by display name) ---
buyer clientAccountId:        __________________   (REQUIRED)
buyer display name (label):   __________________   (documentation/UI label only)

--- Commercial (snapshotted in SA360 on Client Lead Order create) ---
Payment / order approval:     [ ] confirmed outside card charging
Exact quantity:               ______   (minimum 1)
Commerce age bucket (ONE):    [ ] 1–3 ($6) [ ] 3–6 ($4) [ ] 6–9 ($3) [ ] 9–12 ($2) [ ] 12+ ($1)
Quoted unit price:            $______   (server registry; not UI literals)
Quoted order value:           $______   (= qty × unit price)
pricingVersion:               ppl_aged_beta_2026_08_v1

--- Inventory parameters ---
Niche:                        [ ] Veteran (vet)  [ ] Trucker (trucker)  [ ] Nurse  [ ] Mortgage
States:                       __________________
Expected delivery date:       __________________

--- Delivery ---
Destination spreadsheet:      __________________
Manual upload operator:       Alex
CSV contract confirmed:       [ ] buyer_csv_v2 niche columns acknowledged
Optional field blanks OK:     [ ] confirmed (never block eligibility)

--- Duplicate policy ---
Supported replacement reason: DUPLICATE only
Buyer free-text alone:        NOT accepted

--- Sign-off ---
Commercial OK:                [ ] ____/____/____
Ops OK:                       [ ] ____/____/____
Buyer policy acknowledged:    [ ] ____/____/____
```

---

## 4. Alex operator flow (FOWB)

Exact order:

1. **Client Lead Order** — client + niche + states + **one commerce age bucket** + quantity  
   UI shows: Age bucket · Price / lead · Quantity · Order total  
   Server creates `LeadOrderLine` with snapshotted `unitPriceCents` / `lineTotalCents` / pricing version.
2. **Activate** — order must be active before selection
3. **Selection Preview** — Stage 2b; bucket is **locked** to the priced order line (Alex cannot select a different priced bucket)
4. Inspect economics after selection:
   - Requested / Selected / Shortfall
   - Quoted unit price
   - Requested order value / Delivered value / Potential refund-credit  
   **Do not automatically issue refunds. Do not change discounts. Do not charge card.**
5. If `scan_limit_reached`: label **search incomplete** — do **not** treat potential credit as confirmed
6. **Commit / Reserve Leads** — only when preview is complete
7. **Export Preview** — Stage 2c; `buyer_csv_v2` columns + optionalFieldCoverage counts (no PII values)
8. **Commit Export** — immutable `LeadDeliveryExportPackage` with metadata snapshot (schema, niche, bucket, pricing version, unit price, qty, row count)
9. **Download CSV** — local artifact only; **does not** mark delivered
10. **Manual send/import** to client spreadsheet
11. Enter exact phrase: **`MARK SPREADSHEET DELIVERED`**
12. Verify evidence + `BuyerDeliveredIdentity` count

### Download vs delivered

| Action | Writes `BuyerDeliveredIdentity`? |
|---|---|
| Export preview | No |
| Export commit | No (package + metadata only) |
| Download CSV | **No** |
| Manual spreadsheet import | Outside SA360 |
| **MARK SPREADSHEET DELIVERED** | **Yes** |

### Partial fill reconciliation (ops only)

Example: 3–6 Months @ $4, requested 100, selected 87:

| Metric | Value |
|---|---|
| Requested order value | $400 |
| Delivered value | $348 |
| Potential refund/credit | $52 |

No automatic refund. Manual ops reconciliation outside SA360 payment rails.

### True inventory exhaustion vs scan limit

| Outcome | Meaning | Preview | Commit / Reserve |
|---|---|---|---|
| Enough eligible before ceiling | Success | `ok` with selected qty | Reserves selected set |
| DB exhausted, partial eligible | Confirmed shortfall / partial fulfillment | `ok` with `shortfallQuantity` | May reserve partial set |
| DB exhausted, zero eligible | No inventory | `no_inventory` | No writes |
| Scan ceiling before qty verified | Incomplete search | `scan_limit_reached` | **Fail closed — no reservation** |
| Scan ceiling, zero eligible found so far | Incomplete search | `scan_limit_reached` | **Fail closed** |

When FOWB shows scan-limit warning:

> Selection search reached its safe scan limit before the requested quantity could be verified. No leads were reserved. Narrow the states or age buckets and retry.

**Do not** treat scan-limit as “Shortfall — partial fulfillment” or confirmed credit.

### Replacement path

Same distinction: true DB exhaustion → shortage; scan ceiling before a replacement candidate is found → `scan_limit_reached` (do not claim “no replacement exists” if search was truncated).

---

## 5. Rollback

| Stage | Behavior |
|---|---|
| **Before reserve** | Do not commit. Leave inventory available. |
| **Reserved, not delivered** | Release reserved allocations via supported release path. Do **not** mark spreadsheet delivered. |
| **Export committed, not delivered** | Keep package; do **not** run `MARK SPREADSHEET DELIVERED`. |
| **Already delivered** | Do **not** casually release or undo delivery history. Escalate for audited correction. |
| **Replacement failure** | Deny / leave open; original stays delivered/unavailable. |

---

## 6. GO / NO-GO

### GO

- Buyer `clientAccountId` verified
- Quantity ≥ 1 and commercially approved
- Exactly one priced commerce bucket snapshotted on the order line
- Preview selection complete (not `scan_limit_reached`) with acceptable eligible qty
- CSV columns match `buyer_csv_v2` for the niche
- Optional field blanks accepted (do not block)
- No external-write adapter active
- LF2 / GHL / snapshot / Meta activation flags off

### NO-GO

- `scan_limit_reached` unresolved (narrow filters or escalate)
- Attempt to select a different commerce bucket than the priced order line
- Fresh / Semi-Fresh treated as purchasable
- Insufficient confirmed eligible inventory when exact fill is required
- CSV forbidden-field exposure / mixed-niche export
- Any unexpected external write
- Delivery recording failure / non-idempotent mark-delivered
- PPL flags left on outside controlled window without ops decision

---

## 7. Confirmation phrases

| Action | Exact phrase |
|---|---|
| Record spreadsheet delivery | `MARK SPREADSHEET DELIVERED` |
| Approve replacement | `APPROVE REPLACEMENT` |

---

## 8. Known deferred features

- Actual Google Sheets API delivery
- Fresh / Semi-Fresh purchasable products (HOLD until acquisition cost known)
- Automatic refunds / card charges / discount engine
- Niche-specific price overrides beyond default aged schedule
- Production inventory backfill of `lead_details`
- Public quality scoring
- Mandatory outcome reporting
- Broad production rollout without per-client CSV contract confirmation

---

## 9. Local rehearsal notes

Keep PPL feature flags disabled outside local / controlled test environments.

```powershell
$env:SA360_TEST_DATABASE_URL = "postgresql://sa360:<local-compose-password>@127.0.0.1:5432/sa360_test"
$env:SA360_PPL_SELECTION_ENABLED = "true"
$env:SA360_PPL_CSV_EXPORT_ENABLED = "true"
$env:SA360_PPL_REPLACEMENT_ENABLED = "true"
$env:SA360_LF2_EXECUTION_ENABLED = "false"
$env:SA360_LF2_GHL_CANARY_ENABLED = "false"
# Leave all SA360_LF2_GHL_ALLOWED_* unset
pnpm --filter @sa360/api test
```

Do not run migrate/seed/tests against remote DigitalOcean using root `.env` `DATABASE_URL`.
