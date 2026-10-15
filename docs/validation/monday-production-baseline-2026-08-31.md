# Monday production truth / release baseline — 2026-08-31

Read-only / validation audit. No production writes, deploys, env changes,
migrations, LeadCapture webhook triggers with lead payloads, NextGen stage
changes, or product-code edits.

Audit branch: `cursor/monday-production-baseline-e7a2`  
Audit instant: `2026-08-31T12:26Z`–`12:30Z` UTC  
Auditor: Cloud Agent (Thread A)

Evidence classes used below:

- **OBSERVED** — measured this run (public HTTP, `gh`, git, local files)
- **CODE** — current `origin/master` source semantics
- **PRIOR** — merged validation on this same product SHA (`#99` / `#100`)
- **UNCERTAIN** — not independently readable without admin/DO credentials

---

## 1. Executive verdict

**YELLOW**

Production API is healthy and deployed at the exact current `origin/master`
SHA. The customer-journey product path through Approve & Release, portal
Ready, secure CSV download, and order-linked leads is present on master and
was proven locally on this product SHA (PR `#99` on top of `#100`). LeadCapture
legacy and NextGen HTTP endpoints are live and fail-closed. Code defaults deny
uncontrolled live GHL / LF2 / NextGen `inventory_only` / PPL selection.

YELLOW (not GREEN) because several production truths could not be read this
run: worker SHA, admin-coc SHA, production `_prisma_migrations` count,
`SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE`, PPL/LF2/runtime-mode env values,
Resend configuration, and the latest natural NextGen event.

**Recommendation:** safe to proceed with **controlled beta preparation**.
Not a go-ahead to flip NextGen `inventory_only`, LF2 execution, PPL live
selection/export, or GHL live canary.

---

## 2. Current master SHA

**OBSERVED:** `6fab3f5f10caf9a54df473375388d527e8e5837f`

```
6fab3f5 Final customer-journey regression after #96 and #98 (#99)
```

Fetched `origin/master` at audit start. Working tree matched that SHA.
Product code on HEAD is identical to `#100`
(`d65c4fd41b05083e5288702faba2b71192ba0b04`). Diff `d65c4fd..6fab3f5` is
validation-only: harness + report + evidence JSON.

---

## 3. Current deployed SHA(s)

| Component | SHA | How known | vs master |
| --- | --- | --- | --- |
| **API** (`https://sa360-sw6oq.ondigitalocean.app`) | `6fab3f5f10caf9a54df473375388d527e8e5837f` | **OBSERVED** `GET /health` → `commitSha` + `buildSource=SA360_BUILD_COMMIT_SHA` | **exact match** |
| **Worker** | not independently readable | no public `/health`; no `doctl` / DO token | **UNCERTAIN** — likely same App Platform git ref as API if they share one app |
| **admin-coc** (`https://sa360-api-staging-coo57.ondigitalocean.app`) | not embedded in public HTML/RSC | `/` → 307 `/login`; `/login` 200; `/portal/login` 200; `/agent-workspace` 200 | **UNCERTAIN** — last admin-coc product commit is `#95` `dad1c74`; if auto-deployed from master, SHA would be `6fab3f5` |
| **sa360-migrate PRE_DEPLOY job** | not observable | no GitHub Deployments; no DO API | **UNCERTAIN** whether the job exists and which SHA it last ran |

### Deployment health (OBSERVED)

| Check | Result |
| --- | --- |
| `GET https://sa360-sw6oq.ondigitalocean.app/health` | **200** `{ok:true, service:"api", commitSha:"6fab3f5f…", commitShort:"6fab3f5", buildSource:"SA360_BUILD_COMMIT_SHA"}` |
| `GET …/health/db` | **200** `{ok:true, db:"connected"}` |
| `GET …/health/queue` | **200** `{ok:true, queue:"PONG"}` |
| `GET …/admin/v1/health` | **401** `{ok:false, error:"Unauthorized"}` — admin auth is on; body not readable without `ADMIN_API_KEY` |
| `GET …/admin/v1/delivery-runtime-mode` | **401** — runtime posture not readable this run |
| admin-coc `/login`, `/portal/login`, `/agent-workspace` | **200** HTML |
| GitHub Deployments API | empty |
| GitHub Actions / check-runs on `6fab3f5` | none (no `.github/workflows`) |

SHA observability on API is **fixed** vs the 2026-07-09 LF2 runbook (`commitSha: null`).

---

## 4. Migration state

| Item | Value | Class |
| --- | --- | --- |
| Expected repo migration count | **71** | **OBSERVED** `prisma/migrations/*` directories; local `prisma migrate status` |
| Local Cloud Agent DB | **71 / 71** applied (`sa360` at `127.0.0.1`) | **OBSERVED** start log + `Database schema is up to date!` |
| Newest migrations | `20260827210000_lead_order_payment_confirmation_v1` (`#90`), `20260828180000_delivery_release_customer_notify_v1` (`#96`) | **CODE** |
| Production applied count | **not safely readable** | **UNCERTAIN** — `.env` `DATABASE_URL` is localhost only; no production-read credentials |
| Pending in production | **unknown** | **UNCERTAIN** |
| Migrations run this audit | **none** (forbidden) | — |

Last documented production count: **45 / 45** on **2026-07-09**
(`docs/operations/lf2-production-migration-runbook.md`). That figure is
**stale** — 26 migrations have landed since, including payment + notify.

**Inference (not proof):** API at `6fab3f5` is process-healthy and `/health/db`
can `SELECT 1`. That does **not** prove the two newest tables/columns exist
in production. Confirm with a read-only `_prisma_migrations` query or the
existing `scripts/production-db-audit.readonly.mjs` when a production-read
credential is available. Do not run `prisma migrate deploy` against
production from this baseline.

---

## 5. Production gate matrix

| Capability | Current state | Safe? | Required before change |
| --- | --- | --- | --- |
| Public API process | **OBSERVED** up at master SHA | yes | none |
| Postgres / Redis from API | **OBSERVED** `/health/db` + `/health/queue` 200 | yes | none |
| Customer journey (spreadsheet path) | **CODE + PRIOR** complete on master; locally proven on `#100`/`#99` | yes for prep | operator flags + Resend before a real customer release email |
| PPL selection (`SA360_PPL_SELECTION_ENABLED`) | **CODE** default off (`=== "true"` only). Production env **UNCERTAIN** | yes while unset | explicit launch window; FO activate + reserve remain operator actions |
| PPL CSV export (`SA360_PPL_CSV_EXPORT_ENABLED`) | **CODE** default off. Production env **UNCERTAIN** | yes while unset | same; Approve & Release still needs confirmation phrase |
| PPL replacement (`SA360_PPL_REPLACEMENT_ENABLED`) | **CODE** default off. Production env **UNCERTAIN** | yes while unset | keep off for first beta (`docs/demo/ppl-aged-inventory-beta-runbook.md`) |
| LF2 execution (`SA360_LF2_EXECUTION_ENABLED`) | **CODE** default false. Last **PRIOR** prod posture 2026-07-09: disabled. Today **UNCERTAIN** | yes while false | do not enable this sprint without a dedicated canary review |
| LF2 GHL canary + `SA360_LF2_GHL_ALLOWED_*` | **CODE** deny-by-default; empty allowlist blocks | yes while unset | all four allowlists + both flags + runtime live_canary |
| GHL adapter max (`GHL_DELIVERY_ADAPTER_MAX_MODE` / `SA360_GHL_LIVE_CANARY_ALLOWED`) | **CODE** default `simulate`. Production env **UNCERTAIN** | yes at default | env ceiling must be `live_canary` before DB toggle can go live |
| Delivery runtime mode (DB `DeliveryRuntimeModeSetting`) | last **PRIOR** 2026-07-09: `simulate`, `canRunLiveCanary: false`. Today **UNCERTAIN** (admin 401) | treat as unknown until `GET /admin/v1/delivery-runtime-mode` | admin read + `ENABLE LIVE CANARY` confirmation; 15–30 min window |
| LeadCapture legacy webhook | **OBSERVED** route live; secret **set** (empty `{}` → **401**, not 503) | intake yes; auto-GHL no | do not POST real leads for tests; delivery still “Review and approve” |
| LeadCapture NextGen webhook | **OBSERVED** route live; secret **set** (empty `{}` → **401**, not 503) | yes at default stage | keep `SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE` unset/`capture_only` |
| NextGen stage | **CODE** default `capture_only`. Production value **UNCERTAIN** | expected safe | read env in DO console; do not set `inventory_only` without a canary ticket |
| NextGen `inventory_only` | **CODE** merged (`#88`); inactive unless stage ≥ `inventory_only` | yes while stage is `capture_only` | controlled canary plan + inventory/dedupe review |
| NextGen live canary (`SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_*`) | **CODE** disabled unless `true` + client + campaign + delivery mode `live_canary` + max-leads | yes at default | all canary env + runtime live_canary + stage `live_canary` |
| Legacy pause list (`SA360_LEADCAPTURE_NEXTGEN_LEGACY_PAUSE_CAMPAIGN_IDS`) | **CODE** unset → legacy unchanged | yes | only set when cutting a campaign to NextGen |
| Customer release email (Resend) | **CODE** no send unless `RESEND_API_KEY` **and** `SA360_TRANSACTIONAL_EMAIL_FROM`. Production **UNCERTAIN** | release still succeeds if send fails | configure Resend before promising customer email; failure cannot roll back spreadsheet release |
| FO workbench banner `simulationOnly` / `LIVE DISABLED` | **CODE** hardcoded TypeScript literals on `FulfillmentOpsSafetyPosture` — **not** the GHL kill switch | do not treat banner as proof | read `flags.*` and `/admin/v1/delivery-runtime-mode` |

**Uncontrolled live delivery capability in code?** **No.** Every live GHL /
LF2 / NextGen live-canary / PPL select-export path is deny-by-default and
requires stacked env + (where applicable) DB runtime mode + operator
confirmation. Production env values themselves were **not** readable this
run, so “flags are off in DO” is **UNCERTAIN**, not OBSERVED.

---

## 6. Customer journey state

Intended path is **present on current master**. No new production order was
created. Evidence is **CODE** plus **PRIOR** `#99` connected harness on
product SHA `d65c4fd` (HEAD `6fab3f5` adds only validation files).

| Step | On master? | Evidence |
| --- | --- | --- |
| Client creation | yes | `POST /admin/v1/clients`; `#99` step 2.1 PASS |
| Onboarding | yes | portal profile write + `readyToOrder`; `#92` / `#99` |
| Order request | yes | `POST /client/v1/lead-orders`; `#93` / `#99` |
| Payment confirmation | yes | Front Office confirm; does not auto-approve; `#91` / `#90` |
| Approval | yes | approve requires payment; `#91` / `#99` |
| Fulfillment activation | yes | FO activate + PPL flags; `#99` |
| PPL reserve/select | yes | reserve 2 of 5; unreleased package hidden; `#99` |
| Export | yes | commit export; customer download 404 until release; `#94` / `#99` |
| Approve & Release | yes | `markSpreadsheetDelivered` + confirmation phrase; `#94` / `#96` |
| Customer release notification | yes | post-commit notify; `#96` / `#100` / `#99` |
| Portal Ready | yes | “Your order is ready”; `#95` / `#99` |
| Secure CSV download | yes | tenant-scoped; `#94` / `#99` |
| Order-linked delivered leads | yes | `#98` fix + `#99` three-way agreement 5/2/3 |

`#99` harness (2026-08-28): **42 / 42 PASS** on `LO-1064` (local
`sa360_test` only). Focused API 52 PASS; portal journey 40 PASS; API `tsc`
and admin-coc Next build PASS. See
`docs/validation/customer-journey-final-regression.md` and
`docs/validation/customer-journey-e2e-mvp-evidence.json`.

Monday 2026-08-31 local reconfirm (this run, no production): focused unit
tests **37 / 37 PASS** covering notify `#100` semantics, CSV-export notify
attachment, NextGen stage default, commerce HOLD, and NextGen live-canary
deny-by-default.

Manual operator steps still required for a real customer: enable portal +
share shared-password login; confirm Stripe **outside** SA360; Confirm
payment; Approve; Activate with PPL flags on; select/reserve; commit export;
review CSV; Approve & Release.

---

## 7. Notification path (after `#96` / `#100`)

**CODE** in `apps/api/src/services/ppl-fulfillment/delivery-release-notify.service.ts`
and `buyer-csv-export.service.ts`. Confirmed **PRIOR** by `#99` and **OBSERVED**
again by Monday unit tests.

| Rule | Current semantics |
| --- | --- |
| New release creates explicit intent | First `markSpreadsheetDelivered` transaction sets `customerReleaseNotifyStatus = pending` only when `spreadsheetDeliveredAt` is written |
| Historical released rows with null status do not send | Null is excluded from `customerReleaseNotifyClaimWhere`. Replay returns `no_intent` / `legacy_no_notification_intent` and leaves status null |
| Successful sends are idempotent | Claim is durable; `sent` → `already_sent`; Resend `Idempotency-Key` is `delivery-release:{exportId}` |
| Failure cannot roll back spreadsheet release | `attachCustomerReleaseNotification` runs **after** the release transaction. Notify errors are caught; result still `ok: true` for the release with `customerNotification.status = failed` |

Export commit does **not** set pending (stays null until Approve & Release).
If Resend is unset, send returns `skipped: true` / failed and the package
remains released.

---

## 8. LeadCapture legacy state

| Topic | State | Class |
| --- | --- | --- |
| Endpoint | `POST /webhooks/leadcaptureio` registered | **OBSERVED** (GET 404; POST empty body 400 then `{}` → 401) |
| Secret configured? | **Yes** — 401 not 503 | **OBSERVED** |
| Intake active? | Route + secret imply configured intake. Campaign volume **UNCERTAIN** | mixed |
| Auto GHL delivery? | **No** — `processLeadCaptureIoWebhookIntake` comment and `nextAction`: “Review and approve delivery in Admin C.O.C.” | **CODE** |
| Canonical inventory | After normalize + route/dedupe persist, `trackCampaignInventorySafely` (`sourceLane: leadcapture_io`) | **CODE** |
| Fresh HOLD aging | Derived, not a status rewrite: age 0–9 `FRESH_HOLD`, 10–29 `SEMI_FRESH_HOLD`, both not purchasable; day 30 → `COMMERCE_1_3_MO` | **CODE** `commerce-lifecycle.ts` |
| Dedupe | Indexed identity: same event, sourceLeadId, phone fingerprint, email fingerprint, bounded historical JSON. No unbounded corpus scan | **CODE** |
| NextGen pause list | Unset → legacy campaigns not paused | **CODE** |
| Known current issue | None newly observed. Historical James Torrey numeric IDs are not joinable to NextGen Data API UUIDs (trust-pilot docs) | **PRIOR** |

Empty `{}` POSTs this run were **auth probes only** (no lead fields). They
may have created `WebhookRequestLog` rows. They did **not** create
`SourceLeadEvent` / inventory (401 before intake).

---

## 9. LeadCapture NextGen state

| Topic | State | Class |
| --- | --- | --- |
| Endpoint | `POST /sources/leadcapture/nextgen/lead-created` live | **OBSERVED** |
| Secret configured? | **Yes** — 401 not 503 (`SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET` is set) | **OBSERVED** |
| Configured stage | **UNCERTAIN** (env not readable) | — |
| Expected stage | **`capture_only`** unless production was intentionally changed | **CODE** default + `docs/demo/leadcaptureio-webhook-setup.md` |
| `inventory_only` capability | Merged `#88` (`066879b`). Runs only when stage ≥ `inventory_only`. At `capture_only`: persist `SourceLeadEvent` status `received`, **no** normalize / inventory / routing / outbox / GHL | **CODE** |
| Live canary | Separate env + stage `live_canary` + delivery mode `live_canary` + max-leads | **CODE** |
| Latest natural NextGen event | **not observable** (admin/DB required) | **UNCERTAIN** |
| Blocker before a future controlled `inventory_only` canary | 1) Confirm production stage is still `capture_only`. 2) Read-only inventory/dedupe review. 3) One-event promote path already exists (`scripts/leadcapture-nextgen-one-event-promote.ts`) and does not POST the public webhook. 4) Do not raise stage in this baseline. | — |

`#84` (null optional fields) is already on master. No remaining code blocker
for **keeping** `capture_only`. Raising the stage is an operator decision,
not a missing merge.

---

## 10. Outstanding blockers ranked

### P0 — true current product blockers

**None observed** for the current spreadsheet customer-journey path, provided
production PPL/LF2/NextGen-stage/runtime-mode values remain at deny-by-default
(those values are **UNCERTAIN** until an admin/DO read).

### P1 — confirm before any flag change or first real customer release

1. Read production `_prisma_migrations` (expect 71 / 71). Do not migrate from this audit.
2. Read `GET /admin/v1/delivery-runtime-mode` and `GET /admin/v1/fulfillment-ops/safety` (`flags.*`).
3. Confirm in DO console (read-only): NextGen stage unset/`capture_only`; all `SA360_LF2_*` off; PPL flags only on if a controlled window is intentional; Resend pair set before promising email.
4. Independently confirm worker and admin-coc deployed SHAs (DO component `COMMIT_HASH` or bind `SA360_BUILD_COMMIT_SHA` / `NEXT_PUBLIC_SA360_BUILD_COMMIT_SHA`).
5. Decide whether production PPL flags are already on from last week’s journey work — if on, treat as an active controlled window, not “defaults off.”

### P2 — non-blocking

- Open draft **PR `#10`** (2026-06-22) “Add client launch configuration backlog item” — stale docs/kanban seed; **not pending product work**.
- Closed unmerged **PR `#97`** — earlier journey validation; **superseded by `#99`**. Do not reopen as product work.
- GitHub issue **`#71`** — “Show client name in Stage 2 order selector” (FO UX).
- No GitHub Actions on the repo — CI is local/Cloud-Agent only.
- FO safety banner hardcodes `LIVE DISABLED` even when flag booleans are true — operators must read `flags`, not the banner.
- Facet snapshot rebuild / inventory scan-ceiling are performance/ops topics (`#77`, PPL runbook), not journey blockers.

### Later

- Issue `#54` first controlled **live** fulfillment canary (GHL/LF2) — out of scope.
- NextGen `inventory_only` canary — capability merged, not authorized.
- Stripe charging, portal invite email, per-user passwords — explicitly out of the journey contract.
- Roadmap issues `#45`–`#53`, `#13`–`#18`.

---

## 11. Explicit recommendation

**Safe to proceed with controlled beta preparation.**

Not safe to:

- activate NextGen `inventory_only`
- activate LF2 / PPL **live GHL** delivery
- treat worker/admin-coc/migrate as proven-equal to master without a SHA read
- promise customer email until Resend is confirmed
- assume production migrations are 71 / 71 without a DB read

Preparation that **is** in bounds: operator runbooks, flag checklists, local
rehearsal, one-event NextGen promote against already-captured events, and
admin-key **reads** of runtime/safety endpoints.

---

## 12. Repository state (detail)

**Master coherence:** linear squash history; no merge conflict residue.
`#99` is validation-only on `#100`. Week of 2026-08-25–28 completed the
customer-journey stack (`#81`–`#100` relevant merges).

**Latest relevant merged PRs**

| PR | Merged | SHA | Role |
| --- | --- | --- | --- |
| `#99` | 2026-08-28 22:39Z | `6fab3f5` | Final journey regression (HEAD) |
| `#100` | 2026-08-28 22:32Z | `d65c4fd` | Null notify = legacy no-intent |
| `#98` | 2026-08-28 21:43Z | `18f4c77` | PPL order-linked leads |
| `#96` | 2026-08-28 18:42Z | `2cf9c92` | Release notification |
| `#95`–`#90` | 2026-08-27–28 | — | Journey UX / FO / lifecycle |
| `#88` | 2026-08-27 16:51Z | `066879b` | NextGen `inventory_only` (gated) |
| `#87` / `#86` | 2026-08-26–27 | — | Fulfillment + linked leads |

**Open PRs:** only **`#10`** (draft, 2026-06-22). Treat as abandoned backlog
docs. **Do not** treat as pending product work.

**Closed unmerged:** **`#97`** — validation-only predecessor of `#99`.

---

## 13. Known technical debt / test failures (do not fix here)

### A. True current product blockers

None observed on the spreadsheet path. Production flag/SHA/migration
unreadables are **confirmation gaps**, not demonstrated defects.

### B. Known environment / test-harness issues

- No GitHub Actions; empty commit statuses on `6fab3f5`.
- This Cloud Agent has **no** `ADMIN_API_KEY` / `doctl` / production DB URL — admin health, runtime mode, and `_prisma_migrations` cannot be read here.
- Prisma CLI prints an upstream “Update available 6.19.2 → 8.0.0-rc.12” banner locally — noise, not a product failure.
- `#99` evidence SHA field records `d65c4fd` (product HEAD at that run). Current master is `6fab3f5` = that product + validation files only.

### C. Performance / degraded but non-blocking

- Facet snapshot rebuild failure contract (`#77`) — worker last touched here; rebuild remains a background concern.
- PPL selection scan ceiling: `scan_limit_reached` ≠ true exhaustion (runbook).
- Inventory commerce exclusion (`#75`) is intentional safety, not debt.

### D. Future improvements

- Stripe, invite email, per-user auth (journey contract “later”).
- Live GHL canary (issue `#54`).
- NextGen stage raise + one-event promote in production.
- Bind admin-coc / worker commit SHA the same way API already exposes `SA360_BUILD_COMMIT_SHA`.

---

## 14. What this audit did not do

- No deploy, no production env edits, no migrations.
- No NextGen stage change; no PPL/LF2 flag change.
- No LeadCapture lead payload; no new production order.
- No GHL / LeadCapture configuration change.

---

## 15. Operator summary

Production API **is** current master (`6fab3f5`) and healthy. The journey
through release → notify → portal Ready → CSV → linked leads is on master
and was proven locally last Friday on this product SHA. Live delivery remains
deny-by-default **in code**. Confirm the unreadables in section 10 (P1)
before flipping any gate. Safe for beta **preparation**; not safe for
unsupervised activation.
