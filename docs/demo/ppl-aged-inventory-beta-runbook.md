# PPL Aged Inventory Beta — Operator Runbook

Controlled mid-August beta: **manual spreadsheet delivery only**.

Validated baseline: `master` @ `69f15fe` (proposed tag `ppl-aged-beta-v0.1.0`).

| PR | Squash | Capability |
|---|---|---|
| #55 | `81c78df` | Buyer-aware exact-quantity selection |
| #56 | `e32c263` | Buyer-safe CSV export + manual delivery recording |
| #57 | `1e5a208` | Duplicate-only replacements |

> Do **not** hard-code buyer display names (including Vanessa Powell) into domain logic or authorization. Represent the buyer only via a canonical `clientAccountId`.

---

## 1. Production-readiness checklist

### 1.1 Baseline
- [ ] `origin/master` contains `69f15fe`
- [ ] Working tree clean (or only intentional readiness-doc edits)
- [ ] Local annotated tag `ppl-aged-beta-v0.1.0` exists (push only after approval)
- [ ] Validation report preserved: `C:\Users\samue\Source\sa360-checkpoints\PPL_AGED_BETA_VALIDATION_REPORT.md`
- [ ] Checkpoints retained until production rehearsal succeeds

### 1.2 Safety gates (must remain true before and after deploy)
- [ ] `SA360_PPL_SELECTION_ENABLED` unset or not `"true"` until launch window
- [ ] `SA360_PPL_CSV_EXPORT_ENABLED` unset or not `"true"` until launch window
- [ ] `SA360_PPL_REPLACEMENT_ENABLED` unset or not `"true"` until launch window
- [ ] `SA360_PPL_LOCAL_MIN_QTY` **unset in production** (production min qty = **100**)
- [ ] `SA360_LF2_EXECUTION_ENABLED=false` or unset
- [ ] `SA360_LF2_GHL_CANARY_ENABLED=false` or unset
- [ ] All `SA360_LF2_GHL_ALLOWED_*` **unset**
- [ ] No Google Sheets API / GHL / webhook / email / CRM live write path selected for this beta
- [ ] Buyer delivery = download CSV + **manual** Google Sheet upload only

### 1.3 People / commercial
- [ ] Aaron: payment/order approval outside SA360
- [ ] Alex: operator for FOWB Stages 2b–2d
- [ ] Vanessa (buyer): spreadsheet destination + duplicate-policy acknowledgement
- [ ] First-order configuration worksheet completed (Part 3)

### 1.4 Technical
- [ ] Production DB backup taken
- [ ] PPL migrations applied (or confirmed already present)
- [ ] Prisma validate OK; API/Admin healthy
- [ ] Inventory dry-run shows ≥ requested eligible qty
- [ ] GO gates all pass (Part 7)

---

## 2. Production environment checklist (sanitized)

PPL flags default **off** unless the value is exactly `"true"`.

### Required / relevant variables

| Variable | Production beta expectation | Notes |
|---|---|---|
| `DATABASE_URL` | Production Postgres URL | Never commit; rotate via secrets manager |
| `REDIS_URL` / queue URL | Production Redis if API uses queues | Existing SA360 ops |
| `SA360_ADMIN_API_KEY` (or `ADMIN_API_KEY`) | Set for Admin→API auth | Do not log |
| `NEXT_PUBLIC_SA360_API_BASE_URL` | Production API base (Admin) | Public URL only |
| Session / auth secrets used by Admin C.O.C. | Present per existing deploy | Unchanged by PPL |
| `SA360_PPL_SELECTION_ENABLED` | `"true"` **only** during controlled launch | Default off |
| `SA360_PPL_CSV_EXPORT_ENABLED` | `"true"` **only** during controlled launch | Default off |
| `SA360_PPL_REPLACEMENT_ENABLED` | `"true"` **only** during controlled launch | Default off |
| `SA360_PPL_LOCAL_MIN_QTY` | **Must be unset** | Local/test only; production min = 100 |
| `SA360_LF2_EXECUTION_ENABLED` | `false` / unset | Live LF2 execution off |
| `SA360_LF2_GHL_CANARY_ENABLED` | `false` / unset | GHL canary off |
| `SA360_LF2_GHL_ALLOWED_CLIENT_IDS` | **unset** | Empty deny |
| `SA360_LF2_GHL_ALLOWED_LOCATION_IDS` | **unset** | Empty deny |
| `SA360_LF2_GHL_ALLOWED_ORDER_IDS` | **unset** | Empty deny |
| `SA360_LF2_GHL_ALLOWED_SOURCE_LANES` | **unset** | Empty deny |

### External-write gate confirmation

| Path | Beta posture |
|---|---|
| GHL CRM (`ghl.crm.v1`) | Blocked by LF2 execution + canary + empty allowlists |
| Webhook (`webhook.generic.v1`) | Not used for this beta |
| Google Sheets API (`google_sheets.v1`) | Not used; manual upload only |
| File export adapter (`file_export.csv.v1`) | Simulation/evidence only; **no Sheets write** |
| PPL CSV package download | Local artifact; operator copies to Sheet manually |
| Email / SMTP / SendGrid | Not part of PPL path |

`externalWriteOccurred` must remain **false** for selection, export, mark-delivered, and replacement.

### Quantity policy

- Production minimum: **100** (`PPL_PRODUCTION_MIN_QTY`)
- Under 100 → reject `under_100_unresolved`
- `SA360_PPL_LOCAL_MIN_QTY` must never be set in production

---

## 3. First-order configuration worksheet

**Do not create the order until every field is operator-confirmed.**

Copy and fill:

```text
=== PPL AGED BETA — ORDER CONFIG (operator confirmation required) ===

Internal order reference:     __________________
Operator (Alex):              __________________
Date prepared:                __________________

--- Buyer (canonical account; do not authorize by display name) ---
buyer clientAccountId:        __________________   (REQUIRED — production ClientAccount id)
buyer display name (label):   Vanessa Powell       (documentation/UI label only)

--- Commercial (outside SA360 payment) ---
Payment / order approval:     [ ] confirmed by Aaron
Price tier $/lead:            [ ] 100–199 → $42  [ ] 200–399 → $40  [ ] 400+ → $38
Exact quantity:               ______   (must be ≥ 100; under 100 = REJECT under_100_unresolved)
Extended price:               $______  (= qty × tier)

--- Inventory parameters ---
Niche:                        [ ] Veteran (vet)  [ ] Trucker (trucker)
States (subset of NC,TX,NJ,CA or approved list):  __________________
Age bucket(s):
  [ ] COMMERCE_1_3_MO (1–3 mo)
  [ ] COMMERCE_3_6_MO (3–6 mo)
  [ ] COMMERCE_6_12_MO (6–12 mo)
  [ ] COMMERCE_12_MO_PLUS (12+ mo)
Expected delivery date:       __________________

--- Delivery ---
Delivery file destination:    Google Sheet URL / ID: __________________
Sheet shared with buyer:      [ ] confirmed
Manual upload operator:       Alex

--- Duplicate policy (communicate to buyer before delivery) ---
Supported replacement reason: DUPLICATE only
Evidence requirement:         Independent SA360 proof —
                              (a) same delivered batch identity match, OR
                              (b) prior same-buyer delivery history
Buyer free-text alone:        NOT accepted
Duplicate claim deadline:     __________________
Unsupported (deferred):       disconnected phone, no answer, low quality,
                              invalid/incomplete name, dissatisfaction,
                              wrong demographic, consent complaint, operator request

--- Sign-off ---
Aaron commercial OK:          [ ] ____/____/____
Alex ops OK:                  [ ] ____/____/____
Buyer policy acknowledged:    [ ] ____/____/____
```

### Pricing rules (reference)

| Quantity | $/lead | Action |
|---|---|---|
| &lt; 100 | — | **Reject** `under_100_unresolved` |
| 100–199 | $42 | Allowed |
| 200–399 | $40 | Allowed |
| 400+ | $38 | Allowed |

---

## 4. Production migration procedure

**Do not apply production migrations from a laptop session without ops approval.**

PPL migrations (apply only if missing):

1. `20260727180000_ppl_aged_inventory_selection_v1`
2. `20260727190000_ppl_buyer_csv_export_v1`
3. `20260727200000_ppl_duplicate_replacement_v1`
4. `20260728120000_ppl_spreadsheet_delivery_recorded_v1` (delivery boundary columns)

### Steps

1. **Pre-deployment backup**  
   Snapshot / logical backup of production Postgres; record backup id + timestamp.

2. **Inspect migration status** (read-only)  
   `pnpm exec prisma migrate status` against production URL from secrets (not root `.env` by accident).

3. **Confirm feature flags off** before migrate  
   PPL selection/export/replacement must be off; LF2 execution/canary off; GHL allowlists unset.

4. **Apply migrations** (deploy window)  
   `pnpm exec prisma migrate deploy`  
   Halt on any error; do not continue to flag enablement.

5. **Prisma validate**  
   `pnpm exec prisma validate` and `pnpm exec prisma generate` in the deploy pipeline.

6. **Verify schema objects**  
   Confirm existence of:
   - `BuyerDeliveredIdentity` (+ unique/indexes on client+source, phone/email fingerprints)
   - `ProtectedAgentExclusion`
   - `LeadDeliveryExportPackage` (+ delivery idempotency / delivered-at columns)
   - `LeadReplacementRequest` (+ `requestId` unique)
   Confirm no unexpected DROP/TRUNCATE in applied SQL.

7. **Application health**  
   API `/health`, `/health/db`, Admin login, FOWB page load (flags still off → PPL actions disabled).

8. **Halt / rollback criteria**  
   - migrate deploy failure  
   - missing tables/constraints  
   - health check failure  
   - any flag found enabled unexpectedly  
   → restore from backup; do not enable PPL flags.

9. **Post-migrate confirmation**  
   Re-check sanitized env checklist; leave flags **off** until GO for launch window.

---

## 5. Real inventory dry-run procedure

Purpose: prove eligible supply **without** reserving, exporting, delivering, or writing externally.

### Rules
- Import or read intended Veteran/Trucker aged inventory only
- **No** buyer delivery
- **No** external write (Sheets/GHL/webhook/CRM/email)
- **No** `LeadDeliveryExportPackage` commit
- **No** `BuyerDeliveredIdentity` creation
- Prefer preview/analyze APIs (`preview` selection + exclusion analysis), not commit

### Steps
1. Confirm production (or staging clone) has activated aged inventory lots for Vet/Trucker and target states.
2. Ensure buyer `clientAccountId` exists (label may be Vanessa Powell; auth is by id only).
3. With PPL selection enabled **only on the dry-run environment** (or temporarily in a staging clone), run FOWB Stage 2b **preview** for the worksheet parameters.
4. Capture report:
   - eligible quantity by state + age bucket
   - mapped vs unmapped / non-matching inventory
   - invalid identity count
   - protected-agent exclusion count
   - same-buyer prior delivery exclusion count
   - current-batch duplicate exclusion count
   - unavailable inventory count
5. Verify `eligibleQuantity >= exact quantity` from the worksheet.
6. **Stop. Do not commit selection.**

### Alex inventory approval before reservation
Alex reviews the dry-run report and explicitly approves:
- [ ] Niche/states/buckets match the commercial order
- [ ] Eligible qty ≥ requested exact qty (no buffer assumed)
- [ ] Protected-agent exclusions understood (fail-closed unresolved owners are expected)
- [ ] Prior buyer duplicates correctly excluded
- [ ] No CSV / mark-delivered performed during dry-run
- [ ] Sign: ________________ date: ________

Only after this approval may Alex proceed to commit/reserve in the launch window.

---

## 6. Alex operator launch checklist

### Pre-flight
1. [ ] Payment/order approval confirmed **outside SA360** (Aaron)
2. [ ] First-order configuration worksheet complete
3. [ ] Production migrations + health OK; flags prepared for launch window
4. [ ] Inventory dry-run approved by Alex
5. [ ] Manual Google Sheet destination confirmed and accessible
6. [ ] Duplicate-only policy communicated to buyer

### Launch (exact order)
7. [ ] Enable PPL flags for launch window only (`SELECTION`, `CSV_EXPORT`, `REPLACEMENT` = `"true"`); leave `LOCAL_MIN_QTY` unset; LF2/GHL gates remain off
8. [ ] Confirm buyer + order parameters in FOWB
9. [ ] **Preview** inventory (Stage 2b)
10. [ ] Inspect exclusions and shortage; **STOP** if eligible &lt; requested
11. [ ] **Commit** exact selection (no buffer)
12. [ ] Confirm reserved quantity = requested; refresh and verify persistence
13. [ ] **Preview** CSV → **Commit** immutable export package
14. [ ] Download CSV; inspect headers =  
    `first_name,last_name,phone,email,state,lead_date,niche`  
    Confirm date-only `lead_date`; no agent/supplier/cost/proof/internal ids
15. [ ] Copy/upload CSV to the buyer’s Google Sheet (**manual**)
16. [ ] Confirm the file was actually shared with the buyer
17. [ ] Enter exact phrase: `MARK SPREADSHEET DELIVERED`
18. [ ] Verify evidence `MANUAL SPREADSHEET DELIVERY RECORDED` and `BuyerDeliveredIdentity` count = delivered qty
19. [ ] Monitor duplicate requests (Stage 2d)
20. [ ] Approve **only** independently proven duplicates; deny unproven claims
21. [ ] Use exact phrase: `APPROVE REPLACEMENT`
22. [ ] Generate replacement CSV; manual Sheet share; mark delivered if/when shared
23. [ ] Close order commercially; preserve export checksums, delivery evidence, replacement audit rows
24. [ ] Disable PPL flags after the controlled window (or leave policy as ops decides; default safer = off)

### Stop conditions (immediate halt)
- Eligible qty &lt; requested
- CSV contains forbidden fields
- Any `externalWriteOccurred=true` or live adapter attempt
- Mark-delivered fails or is non-idempotent
- Raw DB / Prisma errors surface to operator UI
- Buyer account id mismatch
- Auth failure
- Protected-agent uncertainty that would wrongly include protected inventory

### Escalation
| Issue | Escalate to |
|---|---|
| Payment / pricing / under-100 | Aaron |
| Inventory quality / agent protection | Aaron + Alex |
| Buyer spreadsheet access | Vanessa (buyer) + Alex |
| SA360 defects / migration / flags | Engineering on-call + Aaron |
| Duplicate policy disputes | Aaron (commercial) + Alex (ops evidence) |

---

## 7. GO / NO-GO gates

### GO (all required)
- Production migrations successful
- API and Admin applications healthy
- Buyer `clientAccountId` verified (display name is label only)
- Sufficient eligible inventory for exact quantity
- Exact quantity ≥ 100 and matches paid tier
- No raw database errors in dry-run or preview
- No external-write adapter active for this path
- Alex can complete Stages 2b–2d in FOWB
- Manual spreadsheet destination confirmed
- Duplicate-only rules communicated to buyer

### NO-GO (any one blocks launch)
- Insufficient eligible inventory
- Incorrect or missing buyer delivery history semantics
- Unreconciled inventory counts
- Protected-agent uncertainty (risk of delivering protected supply)
- Migration error
- Authentication failure
- CSV forbidden-field exposure
- Unexpected external write
- Inability to record delivery idempotently
- `SA360_PPL_LOCAL_MIN_QTY` set in production
- LF2 execution or GHL canary enabled / allowlists populated

---

## 8. Rollback procedure

| Stage | Behavior |
|---|---|
| **Pre-reservation failure** | Do not commit. Leave inventory available. Disable PPL flags if needed. No buyer communication of delivery. |
| **Post-reservation / pre-delivery** | Prefer release of non-delivered reservations via supported release path **only if** not buyer-delivered. If release unsafe, escalate; do not mark spreadsheet delivered. |
| **Export generated but not delivered** | Package may remain immutable. Do **not** run `MARK SPREADSHEET DELIVERED`. Do not create buyer history. Regenerate only via new idempotency key if content must change (prefer keep package; fix process). |
| **Delivery recorded incorrectly** | Do not delete history ad hoc. Escalate for audited correction. Do not re-mark casually; confirm idempotency key semantics before retry. |
| **Replacement workflow failure** | Deny or leave request open; do not force second replacement. Original stays delivered/unavailable. Escalate shortage of replacement inventory. |
| **Migration failure** | Halt deploy; restore DB backup; keep flags off; do not launch. |

---

## 9. Post-launch evidence checklist

Preserve for the order folder / ticket:

- [ ] Internal order reference + `clientAccountId` + order id/number
- [ ] Selection preview + commit results (qty, item/allocation ids)
- [ ] Export id, filename, `contentSha256`, row count
- [ ] Screenshot or note of Google Sheet share confirmation
- [ ] Mark-delivered result + identity count
- [ ] Replacement request ids, evidence match type, decisions, replacement export checksums
- [ ] Confirmation `externalWriteOccurred=false` throughout
- [ ] Flag enable/disable timestamps for the launch window

---

## 10. Workflow stages (product behavior)

### Stage 2b — Selection / reserve
1. Open FOWB → select buyer order (aged-lead / PPL).
2. Choose niche, states, commerce age buckets, exact quantity.
3. **Preview** eligible inventory and exclusion counts.
4. **Commit** exact selection (no buffer).
5. Inventory moves `available → reserved` atomically.

### Stage 2c — Buyer-safe CSV + manual delivery
1. **Preview** CSV (no package, no delivery history).
2. **Commit** immutable `LeadDeliveryExportPackage`.
3. **Download** CSV (does **not** claim delivery).
4. Confirm delivery with exact phrase: `MARK SPREADSHEET DELIVERED`
5. Evidence note: `MANUAL SPREADSHEET DELIVERY RECORDED`
6. Only then are `BuyerDeliveredIdentity` rows written.

### Stage 2d — Duplicate-only replacement
1. Request replacement with `reasonCode: duplicate` for a delivered allocation.
2. Preview independent evidence (same-batch identity **or** prior same-buyer delivery).
3. Buyer free-text is never proof.
4. Approve with exact phrase: `APPROVE REPLACEMENT`
5. System reserves exactly one replacement via canonical buyer-aware selection.
6. Original inventory stays historically delivered / unavailable.
7. Export the replacement package; confirm spreadsheet delivery separately if needed.
8. Deny unproven claims; repeated approval does not issue a second replacement.

### Confirmation phrases

| Action | Exact phrase |
|---|---|
| Record spreadsheet delivery | `MARK SPREADSHEET DELIVERED` |
| Approve replacement | `APPROVE REPLACEMENT` |

### Operating rules
- **No buffer:** commit reserves exact requested quantity.
- **First-come, first-served:** competing commits; loser gets typed `reservation_conflict` / `inventory_changed_retry`.
- **Duplicate-only replacements** (see worksheet deferred list).
- **Manual delivery boundary:** CSV commit ≠ delivered.
- **No external writes** on this beta path.

---

## 11. Local rehearsal (synthetic only)

Local/test only. Keep PPL feature flags **disabled** outside local and controlled test environments.

> Root `.env` may point at a remote database. Override `DATABASE_URL` to localhost Docker Postgres before any migrate, seed, or rehearsal.

```powershell
$env:DATABASE_URL = "postgresql://sa360:sa360password@127.0.0.1:5432/<local_db>"
$env:SA360_PPL_SELECTION_ENABLED = "true"
$env:SA360_PPL_LOCAL_MIN_QTY = "1"          # local/test only; do not enable in production
$env:SA360_PPL_CSV_EXPORT_ENABLED = "true"
$env:SA360_PPL_REPLACEMENT_ENABLED = "true"
$env:SA360_LF2_EXECUTION_ENABLED = "false"
$env:SA360_LF2_GHL_CANARY_ENABLED = "false"
# Leave all SA360_LF2_GHL_ALLOWED_* unset
pnpm exec prisma migrate deploy
pnpm exec tsx scripts/ppl-aged-beta-rehearsal.ts
```

Fixtures: `apps/api/src/services/ppl-fulfillment/ppl-beta-fixtures.ts` (synthetic contacts only).

### Local shutdown
1. Stop API / Admin C.O.C. processes.
2. Leave PPL flags unset/`false` (especially `SA360_PPL_LOCAL_MIN_QTY`).
3. Drop disposable DBs if created.
4. Do not run migrate/seed against remote DigitalOcean using root `.env`.

---

## 12. Known deferred features

- Orders under 100 pricing (production rejects via `under_100_unresolved`)
- Actual Google Sheets API delivery
- Fresh leads
- Billing, refunds, and credits inside SA360
- Public quality scoring
- Mandatory outcome reporting

---

## 13. Proposed release tag (not pushed)

Local annotated tag created at `69f15fe`:

```powershell
# Already created locally. Push only after human approval:
git push origin refs/tags/ppl-aged-beta-v0.1.0
```
