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

### Commercial age buckets

| Key | Label | Age (days) |
|---|---|---|
| `COMMERCE_1_3_MO` | 1–3 months | 30–&lt;90 |
| `COMMERCE_3_6_MO` | 3–6 months | 90–&lt;180 |
| `COMMERCE_6_9_MO` | 6–9 months | 180–&lt;270 |
| `COMMERCE_9_12_MO` | 9–12 months | 270–&lt;365 |
| `COMMERCE_12_MO_PLUS` | 12+ months | 365+ |

Legacy request key `COMMERCE_6_12_MO` is still accepted for matching (expands to 180–&lt;365) but is **not** emitted by new classification and should not be used for new orders.

### Buyer CSV contract (`buyer_csv_v1`)

Columns (in order):

1. `first_name`
2. `last_name`
3. `phone`
4. `email`
5. `state`
6. `lead_date` (date-only)
7. `niche`

**Confirm buyer CSV field contract with the receiving client/operator before broad use.**

---

## 1. Safety gates (must remain true before / after deploy)

- [ ] `SA360_PPL_SELECTION_ENABLED` unset or not `"true"` until launch window
- [ ] `SA360_PPL_CSV_EXPORT_ENABLED` unset or not `"true"` until launch window
- [ ] `SA360_PPL_REPLACEMENT_ENABLED` unset or not `"true"` until launch window
- [ ] `SA360_LF2_EXECUTION_ENABLED=false` or unset
- [ ] `SA360_LF2_GHL_CANARY_ENABLED=false` or unset
- [ ] All `SA360_LF2_GHL_ALLOWED_*` **unset**
- [ ] Snapshot / Meta live paths not activated for this beta
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

Local Docker Postgres (`infra/docker-compose.yml`) example target (password from compose file; do not commit new secrets):

- host: `127.0.0.1`
- port: `5432`
- database: `sa360_test`
- user: `sa360`

```powershell
# Create once inside local Docker Postgres
docker exec sa360-postgres psql -U sa360 -d sa360 -c "CREATE DATABASE sa360_test;"

$env:SA360_TEST_DATABASE_URL = "postgresql://sa360:<local-compose-password>@127.0.0.1:5432/sa360_test"
# Prisma migrate against the test DB only:
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

--- Commercial (outside SA360 payment) ---
Payment / order approval:     [ ] confirmed
Exact quantity:               ______   (minimum 1)
Price / lead (if used):       $______

--- Inventory parameters ---
Niche:                        [ ] Veteran (vet)  [ ] Trucker (trucker)
States:                       __________________
Age bucket(s):
  [ ] COMMERCE_1_3_MO (1–3 mo, 30–<90d)
  [ ] COMMERCE_3_6_MO (3–6 mo, 90–<180d)
  [ ] COMMERCE_6_9_MO (6–9 mo, 180–<270d)
  [ ] COMMERCE_9_12_MO (9–12 mo, 270–<365d)
  [ ] COMMERCE_12_MO_PLUS (12+ mo, 365+d)
Expected delivery date:       __________________

--- Delivery ---
Destination spreadsheet:      __________________
Manual upload operator:       Alex
CSV contract confirmed:       [ ] buyer_csv_v1 fields acknowledged

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

1. **Client Lead Order** — create real internal PPL / aged-lead order for the buyer `clientAccountId`
2. **Activate** — order must be active before selection
3. **Selection Preview** — Stage 2b; inspect eligible qty, exclusions, diagnostics
4. **Commit / Reserve Leads** — only when preview is complete (not `scan_limit_reached`)
5. **Export Preview** — Stage 2c; buyer-safe columns only
6. **Commit Export** — immutable `LeadDeliveryExportPackage`
7. **Download CSV** — local artifact only; **does not** mark delivered
8. **Manual send/import** to client spreadsheet
9. Enter exact phrase: **`MARK SPREADSHEET DELIVERED`**
10. Verify evidence + `BuyerDeliveredIdentity` count

### Download vs delivered

| Action | Writes `BuyerDeliveredIdentity`? |
|---|---|
| Export preview | No |
| Export commit | No (package only) |
| Download CSV | **No** |
| Manual spreadsheet import | Outside SA360 |
| **MARK SPREADSHEET DELIVERED** | **Yes** |

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

Diagnostics to record: rows scanned, pages read, eligible found so far.

**Do not** treat scan-limit as “Shortfall — partial fulfillment”.

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
- Quantity ≥ 1 and commercially approved outside SA360
- Preview selection complete (not `scan_limit_reached`) with acceptable eligible qty
- CSV columns match `buyer_csv_v1`
- No external-write adapter active
- LF2 / GHL / snapshot activation flags off

### NO-GO

- `scan_limit_reached` unresolved (narrow filters or escalate)
- Insufficient confirmed eligible inventory when exact fill is required
- CSV forbidden-field exposure
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
- Fresh leads (&lt; 30 days) on this aged path
- Billing, refunds, and credits inside SA360
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
