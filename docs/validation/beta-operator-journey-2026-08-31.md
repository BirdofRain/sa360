# SA360 Monday Thread B — Controlled Beta Operator Journey

**Date:** 2026-08-31  
**Lane:** Quality (validation only — no product, schema, route, or flag changes)  
**Base:** `origin/master` @ `6fab3f5f10caf9a54df473375388d527e8e5837f`  
**Branch:** `cursor/beta-operator-journey-6d6e`  
**Question:** Can Alex take a legitimate customer from setup through fulfillment and release without Sam explaining hidden system behavior?

**Safety posture for this audit**

- No deploy. No production writes. No feature-flag activation. No live GHL. No real customer email.
- Connected regression uses local `sa360_test` Postgres + injected notification transport only.
- Findings are diagnosed, not implemented.

---

## 1. Verdict

**READY WITH MANUAL GUARDRAILS**

The connected API journey on current master is complete and safe: onboarding gate, payment-before-approve, no `submitted → active` skip, reserved ≠ delivered, unreleased package hidden, Approve & Release commits allocations, tenant isolation, masking, and notify-once / legacy no-intent all hold.

Alex cannot complete the same journey from the operator UI alone. The first paying-customer path is implementable only if someone (Sam, or this runbook) tells him which screens to ignore, which order not to recreate, which tokens to type, and how the customer logs in.

| If… | Then… |
| --- | --- |
| Sam (or this runbook) sits with Alex for the first order, shared portal password is already known, PPL selection/export flags are already on in the beta window, Resend is configured or Alex will notify the customer out of band | Controlled beta is possible |
| Alex is expected to discover the path from labels and page chrome with no briefing | **Not ready** — the first unpaid/untrained attempt will stall at portal login or fulfill the wrong object |

There is **no API-level journey break** on current master. The first **operator** break is portal access (password is env-only). The first **fulfillment** break is Fulfillment Ops: a customer-submitted (unpriced) order opens the legacy LF2 stages and a second “Client Lead Order” create form.

---

## 2. End-to-end PASS / FAIL table

Evidence column: `H` = connected harness (`validate-customer-journey-e2e.ts`); `U` = operator UI / presenter audit on master. Harness results are in §9.

| Step | Actor | Expected | Result | Evidence |
| --- | --- | --- | --- | --- |
| CLIENT SETUP — create / identify customer | Alex | `POST /admin/v1/clients` → `onboarding`, portal off | **PASS** (API) / **FRICTION** (UI) | H 2.1; U `/clients` create form requires a lowercase slug and free-text niches |
| CLIENT SETUP — portal provision | Alex | Enable portal + login email; status stays `onboarding` | **PASS** (API) / **FRICTION** (UI) | H 2.3; U password is `CLIENT_PORTAL_LOGIN_PASSWORD` (env), not on the page |
| CLIENT SETUP — customer login identity | Customer | Portal context resolves the new tenant | **PASS** | H 2.4 |
| CLIENT SETUP — onboarding incomplete cannot order | Customer | `readyToOrder=false`; `409 ACCOUNT_NOT_READY_TO_ORDER` | **PASS** | H 3.1, 3.3, 3.4 |
| CLIENT SETUP — complete onboarding | Customer | `status=active`, `readyToOrder=true` | **PASS** (API) / **FRICTION** (UI) | H 3.5; U placeholders encourage `Veteran` / `Final Expense`, not inventory tokens |
| CLIENT SETUP — paused cannot order | System | `409 ACCOUNT_NOT_READY_TO_ORDER` | **PASS** | H 3.7 |
| CUSTOMER ORDER — submit | Customer | `submitted` + `pending_confirmation` | **PASS** (API) / **FRICTION** (UI) | H 4.1; U portal catalog is GHL/fresh-lead oriented |
| FRONT OFFICE — approve before payment | Alex | `409 payment_confirmation_required` | **PASS** | H 5.1 |
| FRONT OFFICE — skip to active | Alex | `409 submitted_cannot_activate` | **PASS** | H 5.2 |
| FRONT OFFICE — confirm payment | Alex | Payment `confirmed`; status still `submitted` | **PASS** | H 5.3; U no confirmation that Stripe/outside payment was actually seen |
| FRONT OFFICE — approve | Alex | `ready`; payment unchanged | **PASS** | H 5.4; U “Confirm Payment & Approve” exists; activation is a different app |
| FULFILLMENT — activate | Alex | `active` + `pay_per_lead` + `pooled_matching` + qty backfill | **PASS** (API) / **FRICTION** (UI) | H 6.1; U unpriced portal orders show LF2 Stages 3–6 and a second create form |
| FULFILLMENT — unapproved cannot activate | System | `409 submitted_cannot_activate` | **PASS** | H 6.2 |
| FULFILLMENT — reserve partial qty | Alex | 2 reserved; customer committed = 0 | **PASS** (API) / **FRICTION** (UI) | H 7.1–7.3; U qty field defaults to `1`, buckets are raw `COMMERCE_*` keys |
| DELIVERY — export commit | Alex | Package exists; `spreadsheetDeliveredAt` null; notify null | **PASS** | H 8.1 |
| DELIVERY — operator CSV review | Alex | Admin download `text/csv`; delivered header false | **PASS** | H 8.2 |
| DELIVERY — unreleased invisible | Customer | Exports `[]`; leads `[]`; download 404 “Delivery not found” | **PASS** | H 8.3, 8.3b, 8.4 |
| DELIVERY — dashboard not Ready | Customer | Hero is not “Your order is ready” | **PASS** | H 8.5 |
| DELIVERY — Approve & Release | Alex | Allocations committed; identities written; notify sent once; order not auto-completed | **PASS** (API) / **FRICTION** (UI) | H 9.1; U success card does not show notification status |
| DELIVERY — replay | System | No second send | **PASS** | H 9.2 |
| CUSTOMER — fulfillment counts | Customer | 5 requested / 2 delivered / 3 remaining from committed allocations | **PASS** | H 10.1 |
| CUSTOMER — linked leads | Customer | Exactly 2 buyer-safe rows | **PASS** | H 10.1b |
| CUSTOMER — released package visible | Customer | One downloadable package | **PASS** | H 10.2 |
| CUSTOMER — dashboard Ready | Customer | Hero “Your order is ready” | **PASS** | H 10.3 |
| CUSTOMER — secure CSV download | Customer | 200 `text/csv`; no internal columns | **PASS** | H 10.4 |
| CUSTOMER — three-way agreement | System | Fulfillment = linked leads = CSV identities | **PASS** | H 10.5 |
| CUSTOMER — masking | System | Masked phone/email; buyer tenant; no allocation/owner/GHL ids | **PASS** | H 10.6 |
| CUSTOMER — tenant isolation | Tenant B | 404 on A’s order/leads/exports/download | **PASS** | H 11.1 |
| NOTIFICATION — transport fail does not block release | System | Release ok; notify `failed` | **PASS** | H 13.1 |
| NOTIFICATION — legacy null = no-intent | System | Replay does not send; status stays null | **PASS** | H 13.2 |
| FAILURE COPY — account / orders / exports | Portal | Does not fabricate Ready / Complete account / No orders | **PASS** | H 12.1–12.3 |

**First actual journey break (operator, not API):** after Alex creates the client and enables portal, he cannot give the customer a working password from any C.O.C. control. The in-product journey stops at “copy `/portal/login`”. Everything after that requires Sam’s env password (or a pre-shared beta password).

**First fulfillment break (if login is already solved):** Fulfillment Ops for a *customer-submitted* order. That order is unpriced, so the workbench (1) invites Alex to create a *second* Client Lead Order, (2) expands LF2 Stages 3–6 as if they were next, and (3) leaves selection quantity at `1` instead of the customer’s `leadVolume`.

---

## 3. Exact remaining manual Alex steps

These are the steps a first controlled-beta order still requires a human to do. None of this is Stripe, GHL live delivery, or production deploy.

1. **Invent a `clientAccountId` slug** (`[a-z][a-z0-9_]*`) on `/clients`. The form does not suggest one from the display name.
2. **Leave create and open client detail** to enable portal and set `portalLoginEmail`. Those fields are not on create.
3. **Share portal login out of band:** copy `/portal/login` + tell the customer the shared env password (`CLIENT_PORTAL_LOGIN_PASSWORD`). There is no invite email and no per-client password.
4. **Coach niche/product tokens** (or type them himself). Placeholders say `VET` / `Veteran` / `Final Expense`. Inventory selection matches `nicheKey` as a whole string (case-insensitive). `Veteran` does **not** match inventory `vet`.
5. **Wait for the customer to complete `/portal/account`** (or Alex sets `status=active` himself). `readyToOrder` is exactly `status === active`.
6. **Take payment outside SA360** (Stripe dashboard, invoice, retainer). SA360 only stores an attestation.
7. **Open Front Office → Lead Ordering**, find the submitted order, click **Confirm Payment & Approve** (or Confirm, then Approve). No in-app payment proof.
8. **Leave Front Office** via “Open Fulfillment Ops” (`/fulfillment-ops?orderId=…`). Activation is not on the review drawer.
9. **Select the customer’s existing order** in the FOWB dropdown. Do **not** fill “Client Lead Order (CSV / manual fulfillment)” — that creates a second order.
10. **Click Activate order** (no confirm dialog). API backfills `orderKind=pay_per_lead`, `fulfillmentMode=pooled_matching`, `requestedQuantity=leadVolume`.
11. **Ignore Stages 3–6** (eligibility / LF2 reserve / simulate). Those stages are visible for unpriced portal orders.
12. **Set Stage 2b quantity to the customer’s requested volume** (UI defaults to `1`) and keep/choose `COMMERCE_*` bucket keys. Flags `SA360_PPL_SELECTION_ENABLED` and `SA360_PPL_CSV_EXPORT_ENABLED` must already be `"true"` in that environment.
13. **Selection Preview → Commit / Reserve** (partial OK). Confirm reserved rows are the intended states/niche.
14. **Export Preview (optional) → Commit Export → Download CSV.** Review the file locally. Download does not release.
15. **Approve & Release → confirm modal.** Irreversible: customer can download, identities are recorded, notify is attempted.
16. **Verify notify out of band** if Resend is unset or the success card is silent (UI does not show `customerNotification`).
17. **Do not PATCH the order to `completed` unless ops wants it closed.** Release does not auto-complete.
18. **Do not enable GHL / LF2 live / Sheets / Meta** for this beta. Spreadsheet download is the delivery.

---

## 4. Findings (P0 / P1 / P2 / P3)

Do **not** implement these in this PR.

### P0 — cannot safely beta

None found on the **safety** axis (tenant leak, unreleased CSV leak, live GHL write, duplicate notify on replay, approve-without-payment, activate-from-submitted). Those contracts hold on master.

Operator-untrainability is real, but it is recoverable with a runbook. That is P1, not P0.

### P1 — beta possible, serious operator risk

| ID | Finding | What Alex has to know | Why it matters | Likely root cause | Smallest fix (not done) |
| --- | --- | --- | --- | --- | --- |
| P1-1 | Portal password is env-only | `CLIENT_PORTAL_LOGIN_PASSWORD` + `CLIENT_PORTAL_SESSION_SECRET` must already be set; Alex copies URL only | First customer cannot log in from C.O.C. alone | MVP shared-password design (`portal-auth-config.ts`, client detail helper text) | Runbook: Sam issues the beta password once. Later: invite email / per-client secret (Auth/Account) |
| P1-2 | Two order-create paths on the fulfillment page | Customer portal/FO intake ≠ FOWB “Client Lead Order” | Easy to fulfill a new priced order and leave the customer’s `submitted`/`ready` order untouched | FOWB Stage 2 still embeds priced-order create next to Activate | Hide create (or warn) when `?orderId=` is a customer-submitted order; label “do not recreate” |
| P1-3 | Unpriced portal orders expand LF2 Stages 3–6 | Priced PPL collapses those stages; portal orders do not (`isPricedPplOrder = Boolean(selectedOrder?.pricing)`) | Alex can spend the session in simulation eligibility instead of Stage 2b/2c | Collapse gated on pricing snapshot, not on “CSV fulfillment” | Collapse Stages 3–6 for activated `pay_per_lead` / pooled orders, not only priced lines |
| P1-4 | Selection qty defaults to `1` | Customer `leadVolume` / `requestedQuantity` is not copied into the Stage 2b qty field | First release can legally ship 1 of N; customer sees partial and thinks the order is done or broken | `pplQty` initial state is `"1"`; `selectOrder()` does not sync qty | Prefill qty from `requestedQuantity \|\| leadVolume` when an order is selected |
| P1-5 | Niche tokens are free-text; placeholders lie | Inventory match is whole-string, case-insensitive (`nicheKey.equals` / `mode: "insensitive"`). `vet` ≠ `Veteran` ≠ `VET` is OK for VET, but `Veteran` misses | Preview returns no inventory; Alex thinks stock is empty | Create placeholder `VET`; onboarding placeholder `Veteran, Trucker` / `Final Expense, Aged`; portal catalog uses account keys as-is | Constrained niche select (`vet`/`trucker`/`nurse`/`mortgage`) on create + onboarding + order form |
| P1-6 | PPL flags are off by default | `SA360_PPL_SELECTION_ENABLED` / `SA360_PPL_CSV_EXPORT_ENABLED` must be `"true"` in the beta window | Stage 2b/2c fail closed with flag errors Alex cannot fix in UI | Intentional safety default | Ops enables flags only in the controlled window; FOWB should say “selection disabled in this environment” in plain language (copy already mentions the env var — still Sam-shaped) |
| P1-7 | FOWB fulfilled counter is the stored `LeadOrder.fulfilledQuantity` | PPL release commits allocations and does **not** increment that counter (harness: stored fulfilled stays 0) | After a successful release the operator tile can still show `fulfilled=0` | Known contract: customer presenter uses committed allocations; FOWB does not | Show committed-allocation count on Stage 2, or label the tile “legacy counter” |
| P1-8 | Confirm Payment is an attestation with no confirm | Payment happened in Stripe/invoice outside SA360 | Alex can approve an unpaid first customer | Dedicated admin routes by design | Modal: “I confirmed payment outside SA360” before write |
| P1-9 | Release success does not show notify status | API returns `customerNotification`; FOWB type `PplSpreadsheetDeliveryResult` omits it | Alex believes “Released” means the customer was emailed. If Resend is unset, notify is skipped/failed and release still succeeds | UI adapter narrower than API | Surface sent / skipped / failed on the success card |

### P2 — friction worth improving soon

| ID | Finding |
| --- | --- |
| P2-1 | Client create does not collect portal email; Alex must open detail. |
| P2-2 | Client detail mixes portal setup with GHL destination, routing rules, cutover, identity rekey, delete. PPL spreadsheet beta does not need those. |
| P2-3 | Portal “Active” badge is `portalEnabled && status not paused/archived`, including `onboarding`. Looks live before ready-to-order. |
| P2-4 | FO urgent task “N new order(s) awaiting review” links to `/front-office/orders?status=submitted`, but the page only reads `role` from searchParams. Client filter defaults to “Needs review or approved” so the list is usually OK; the URL is still a lie. |
| P2-5 | Portal order catalog campaign/CRM values are Front Office leftovers (`Fresh leads`, `GHL Starter + SA360 AI`, destination `Account CRM`). Activation still backfills PPL, but Alex sees a GHL-shaped request. |
| P2-6 | Commerce buckets on unpriced orders are a comma-separated env-key string, not the priced bucket picker. |
| P2-7 | Activate has no confirmation. Low blast radius (can pause) but easy mis-click. |
| P2-8 | Three shells: `/clients`, `/front-office/orders`, `/fulfillment-ops`. Documented, still a page-leave at every phase. |
| P2-9 | FOWB header “SIMULATION ONLY / LIVE DISABLED” is correct for GHL and easy to misread as “CSV release is fake.” |
| P2-10 | Shared-password helper cites `CLIENT_PORTAL_LOGIN_PASSWORD` by name — developer env, not operator language. |
| P2-11 | No operator queue for “package ready for review” besides staying on the selected order. |
| P2-12 | Confirm Payment & Approve is two API writes (good) with one button and no “this will not activate” reminder on the button itself (banner exists only after `ready`). |

### P3 — cosmetic / later

| ID | Finding |
| --- | --- |
| P3-1 | Stage titles still numbered 2 / 2b / 2c / 2d next to collapsed 3–6. |
| P3-2 | “Phase 5B maps login email…” on client portal card. |
| P3-3 | SHA-256 / idempotent-replay tiles on export are engineer-facing. |
| P3-4 | Replacement “Show restricted tools” is correctly collapsed; still visible chrome. |
| P3-5 | Portal login subtitle still says “performance metrics.” |

---

## 5. Sam knowledge dependency

Anything Alex cannot reasonably know without asking Sam (or reading this file / `docs/demo/ppl-aged-inventory-beta-runbook.md`):

| # | Hidden fact | Where it lives | What Alex sees instead |
| --- | --- | --- | --- |
| 1 | Shared portal password + session secret | Env on admin-coc | “Copy portal login URL” |
| 2 | `readyToOrder` is only `ClientAccount.status === active` | Presenter | Portal badge “Active” vs account status dropdown vs customer “Complete your account” |
| 3 | Cutover / GHL / routing on client detail are **not** required to take a PPL spreadsheet order | Client detail sections | A page that looks like CRM onboarding is the job |
| 4 | Customer onboarding writes niches that become the order catalog; those strings must match inventory (`vet`, not `Veteran`) | Selection query | Placeholders “Veteran, Trucker” |
| 5 | Payment is outside SA360; the button only attests | FO review actions | “Confirm payment” looks like charging |
| 6 | Approve (`ready`) ≠ Activate (`active`) | FO banner + FOWB | After approve, nothing fulfills until FOWB Activate |
| 7 | Do not create a FOWB Client Lead Order for a portal customer | Stage 2 create form | The most complete-looking form on the page |
| 8 | Activate silently sets `pay_per_lead` / `pooled_matching` / qty | `activateFulfillmentOpsOrder` | “Activate order” with no explanation of PPL |
| 9 | For portal (unpriced) orders, Stages 3–6 are leftover LF2, not CSV fulfillment | `isPricedPplOrder` | Full eligibility/reserve/simulate workbench |
| 10 | Stage 2b qty defaults to 1 | React state | A filled-in quantity that looks intentional |
| 11 | Bucket keys are `COMMERCE_1_3_MO` etc.; Fresh/Semi-Fresh are HOLD | Pricing catalog + runbook | A text box of constants |
| 12 | PPL selection/export flags default off | Env | Cryptic flag errors or empty preview |
| 13 | Reserved holds are invisible to the customer until Approve & Release | Allocation presenter | FOWB reserved count vs portal 0 delivered |
| 14 | `LeadOrder.fulfilledQuantity` is not the customer number | Known PPL contract | FOWB `fulfilled` stays 0 after release |
| 15 | Approve & Release may email `portalLoginEmail` if Resend is set; UI does not show the outcome | Notify service + FOWB adapter | Green “Released” |
| 16 | Historical packages with null notify status must not be “fixed” by replay | #100 | Temptation to click release again to “send the email” |
| 17 | Do not turn on LF2 GHL canary / live execution for this beta | Safety badges + runbook | Badges exist; meaning is Sam’s |

---

## 6. Suggested Beta Runbook checklist

Print this for the first controlled paying customer. Do not enable live GHL. Do not send from a personal mailbox if Resend is the intended path — if Resend is unset, tell the customer in Slack/SMS that the portal download is ready.

### Before the customer exists

- [ ] Confirm this is spreadsheet / PPL aged inventory, not live GHL delivery.
- [ ] Confirm `SA360_PPL_SELECTION_ENABLED=true` and `SA360_PPL_CSV_EXPORT_ENABLED=true` **only** in the controlled beta environment (Sam/ops). Leave LF2 GHL / live execution off.
- [ ] Confirm Resend is configured **or** accept that release will not email and Alex will notify manually.
- [ ] Alex has the shared portal password in a password manager (from Sam). He never pastes it into Slack with the login URL if that channel is shared.

### Client setup

- [ ] `/clients` → Create. Slug: lowercase `first_last` or business slug. Display name: legal/business name.
- [ ] Niches: type `vet` or `trucker` or `nurse` or `mortgage` — not “Veteran”.
- [ ] Products: type `aged_leads` (not “Final Expense”) unless Sam says otherwise.
- [ ] Open the new client. Enable portal. Set login email to the customer’s real inbox. Save.
- [ ] Copy portal login URL. Send URL + password out of band.
- [ ] Ignore GHL destination, routing rules, cutover, identity rekey for this order.
- [ ] Do not set status `active` unless the customer cannot finish `/portal/account`. Prefer they complete onboarding.

### Customer

- [ ] Customer signs in, completes account (niches/products if empty), sees ready-to-order.
- [ ] Customer submits an order (volume, states, niche). Status will be Submitted / Payment pending. That is correct.
- [ ] Alex collects payment outside SA360.

### Front Office

- [ ] `/front-office` urgent task or `/front-office/orders` (filter: Submitted / Payment pending).
- [ ] Open the customer’s order — match client name + volume + states. Do not use “Create order (admin)” unless Sam says this customer will not use the portal.
- [ ] Confirm Payment & Approve (only after payment is really confirmed).
- [ ] Banner: “Approved — ready for fulfillment.” Click **Open Fulfillment Ops**.

### Fulfillment Ops

- [ ] Confirm the URL has `orderId=` for **that** order. Select it in the dropdown if needed.
- [ ] Do **not** create a Client Lead Order on this page.
- [ ] Click **Activate order**. Status becomes `active`. Kind should be pay-per-lead / pooled matching.
- [ ] Scroll to Stage 2b. Set quantity to the customer’s requested volume. Do not leave `1` unless this is an intentional partial batch.
- [ ] Keep aged commerce buckets only (default all-aged string is OK for unpriced orders). Do not use Fresh / Semi-Fresh.
- [ ] Selection Preview. If SEARCH INCOMPLETE, do not treat as shortage; narrow and retry. If shortfall after a complete scan, decide partial with the customer.
- [ ] Commit / Reserve. Portal still shows 0 delivered. That is correct.
- [ ] Stage 2c: Export Preview (optional), Commit Export, Download CSV, review rows (niche, state, count).
- [ ] Approve & Release → read the modal → confirm. This is irreversible for those identities.
- [ ] If the success card does not mention email, notify the customer yourself.

### After release

- [ ] Customer dashboard: “Your order is ready” + download.
- [ ] Delivered count = reserved/released count, not remaining.
- [ ] Do not replay Approve & Release to “resend email.”
- [ ] Do not complete the order unless no more batches are expected.

### Stop / escalate to Sam

- [ ] Portal login “not configured” or customer password fails.
- [ ] Selection flag errors or empty inventory after a `vet`/`NC`-style request that should have stock.
- [ ] Accidental second order created in FOWB.
- [ ] Accidental Approve & Release on the wrong CSV.
- [ ] Any prompt to enable GHL canary / live execution.

---

## 7. Top 5 operator improvements (do not implement here)

Ranked by value for the first controlled paying customer.

1. **Prefill Stage 2b quantity from the selected order and hide/disable FOWB create when fulfilling a customer-submitted order.** Stops the two most likely fulfillment mistakes (ship 1 of N; fulfill a twin order).
2. **Collapse LF2 Stages 3–6 for any activated PPL/pooled CSV order, not only priced lines.** Makes the customer-portal path look like the priced beta path.
3. **Constrained niche (and product) picks on client create, portal onboarding, and portal order.** Removes the `Veteran` vs `vet` silent miss.
4. **Show notification outcome on Approve & Release** (`sent` / `skipped` / `failed`) and a one-line “customer can download now.” Stops false confidence that email went out.
5. **Portal invite that does not require Sam:** either print the shared password rule in operator language (“ask Sam for the beta portal password — it is not in this screen”) plus a “Send login email” later, or collect portal email on create. Password-in-UI is an Auth/Account decision.

---

## 8. Recommendation for the first controlled beta

**Proceed with one paying customer, Sam on the call for setup + first release, Alex driving the clicks.**

Use the checklist in §6. Treat the portal as the customer’s system of record for the order. Treat Fulfillment Ops as CSV-only. Do not turn on live GHL to “make delivery easier.”

Do **not** treat this as an Alex-solo launch. The API is ready; the operator path still has hidden forks.

After the first order, the highest-leverage product work is items 1–3 in §7. None of those require a schema migration.

---

## 9. Connected local customer-journey regression

**Command (local `sa360_test` only, injected notify transport, `RESEND_API_KEY` unset):**

```bash
cd apps/api
SA360_VALIDATION_MASTER_SHA=6fab3f5f10caf9a54df473375388d527e8e5837f \
  node --import tsx/esm --import ./src/test/set-test-env.ts \
  src/scripts/validate-customer-journey-e2e.ts
```

**Harness result: 42 passed / 0 failed — READY_TO_MERGE**

| Field | Value |
| --- | --- |
| Generated at | `2026-08-31T12:45:44.719Z` |
| Master SHA | `6fab3f5f10caf9a54df473375388d527e8e5837f` |
| Postgres | `127.0.0.1:5432/sa360_test` |
| Tenant A | `journey_e2e_a_20260831_124544_fnlu` / `journey-e2e-a-20260831_124544_fnlu@example.test` |
| Tenant B | `journey_e2e_b_20260831_124544_fnlu` |
| Order | `cmth8eoce0006jsrdsingej2i` / `LO-1044` (5 requested, 2 delivered) |
| Notify | injected transport; 1 send; replay did not resend; transport-fail still released; legacy null = no-intent |
| Real email / GHL / Stripe / production | **not exercised** |

Evidence: `docs/validation/customer-journey-e2e-mvp-evidence.json` (regenerated this run; secret scan clean).

**Also run:** focused API suites (linked leads, release notify, exports, onboarding, lifecycle, FO activate) and focused portal / Front Office / FOWB journey suites. No production writes.

| Check | Result |
| --- | --- |
| Connected harness | **42 passed / 0 failed** |
| Focused API suites | **98 passed / 0 failed** |
| Focused portal + operator UI suites | **104 passed / 0 failed** |
| Secrets in evidence | **PASS** (no Resend keys, DB password, Stripe keys, admin/portal keys, or non-`@example.test` recipients) |

FOWB Phase 3 UI test still asserts “retains legacy stages 3–6 for unpriced simulation orders.” Customer portal orders are unpriced, so that passing test is also evidence for finding P1-3.

---

## 10. Operator friction log (by phase)

### Client setup (`/clients` → create → detail)

| Question | Observation |
| --- | --- |
| What Alex has to know | Slug rules; that portal is a second save; password is env |
| Actions | Create (~4 fields) + navigate + portal save (~3 fields) + out-of-band share |
| Unclear labels | Portal badge “Active” during onboarding; “Phase 5B…” |
| Manual data entry | Slug, comma-separated niches/products |
| Leave the page | Create → detail; then leave C.O.C. entirely to share login |
| State not obvious | `readyToOrder` is not shown on client detail (only `status`) |
| Sam/dev knowledge | Password env; niche tokens; ignore GHL |
| Irreversible | Delete client (blocked if dependents); identity rekey (not needed) |
| Missing confirmation | Portal enable is a checkbox + Save, no “this shares the env password” |
| Misleading success | “Save portal settings” does not mean the customer can log in |

### Customer order (`/portal/orders/new`)

| Question | Observation |
| --- | --- |
| What Alex has to know | Customer must be `active`; catalog values are intake, not commerce |
| Actions | Customer: form → review → submit (good) |
| Unclear labels | Campaign “Fresh leads”; CRM “GHL Starter…”; destination “Account CRM” |
| Manual data entry | Reasonable; states are a real picker |
| Leave the page | Customer stays in portal |
| State not obvious | Payment pending copy is honest after submit |
| Sam/dev knowledge | Those catalog strings do not pick a PPL bucket or price |
| Irreversible | Submit is a real order in Alex’s FO queue |
| Missing confirmation | Review step exists (good) |
| Misleading success | Success is fine; Alex may still create a *second* order in FO/FOWB |

### Front Office (`/front-office`, `/front-office/orders`)

| Question | Observation |
| --- | --- |
| What Alex has to know | Payment is outside; approve ≠ activate |
| Actions | 1 combined click, or 2; then leave to FOWB |
| Unclear labels | “Confirm payment” vs charge; status `ready` vs English “approved” (copy is actually good) |
| Manual data entry | None on review if the customer submitted |
| Leave the page | Required for activation |
| State not obvious | Urgent `?status=submitted` ignored; create-admin form still on the page |
| Sam/dev knowledge | Which create form to ignore |
| Irreversible | Approve is reversible only by later PATCH; payment attestation is not a charge |
| Missing confirmation | No “I saw the Stripe payment” modal |
| Misleading success | “Approved — ready for fulfillment” is accurate if Alex follows the FOWB link |

### Fulfillment Ops (`/fulfillment-ops`)

| Question | Observation |
| --- | --- |
| What Alex has to know | Almost the entire PPL CSV ritual; see §5 |
| Actions | Activate + preview + reserve + export commit + download + release + modal ≈ 7–9 clicks, plus qty/bucket edits |
| Unclear labels | SIMULATION ONLY vs real CSV release; Stage 2 vs 3–6; raw bucket keys |
| Manual data entry | Bucket key string; quantity (wrong default) |
| Leave the page | CSV download is a file download; inventory link is unused for this path |
| State not obvious | Reserved vs committed vs stored fulfilled |
| Sam/dev knowledge | Highest of any phase |
| Irreversible | Approve & Release (identities + customer visibility + notify attempt) |
| Missing confirmation | Activate none; Release has a good modal |
| Misleading success | Released without notify status; fulfilled tile may stay 0 |

### Customer experience (`/portal`)

| Question | Observation |
| --- | --- |
| What Alex has to know | Customer only sees committed/released truth — he must not promise reserved counts |
| Actions | Customer: next-action hero → order → download |
| Unclear labels | Login still mentions performance metrics |
| Manual data entry | None after submit |
| Leave the page | Download is a file |
| State not obvious | Partial fulfillment is honest (N of M) once released |
| Sam/dev knowledge | Shared password |
| Irreversible | Download does not re-release (good) |
| Missing confirmation | n/a |
| Misleading success | Failure heroes do not fabricate Ready (harness 12.x) |

### Notification

| Question | Observation |
| --- | --- |
| What Alex has to know | Release records pending→sent; replay is idempotent; null status is legacy no-intent; no Resend ⇒ skip/fail, not rollback |
| Actions | None beyond Approve & Release |
| Unclear labels | UI silence |
| Manual data entry | None |
| Leave the page | If notify failed, Alex must message the customer elsewhere |
| State not obvious | No sent/skipped/failed chip |
| Sam/dev knowledge | Resend env; do not replay to resend |
| Irreversible | Email send (once) when transport works |
| Missing confirmation | Release modal does not mention email |
| Misleading success | Green Released ≠ emailed |

---

## 11. Defects reproduced in code (not implemented)

Validation-only. Stopped before fixing.

### D1 — Unpriced portal orders show LF2 Stages 3–6

- **Repro (code):** `fulfillment-ops-workbench.tsx` — `isPricedPplOrder = Boolean(selectedOrder?.pricing)`; `{!isPricedPplOrder \|\| legacyOpsOpen ? (` renders Stage 3+. Customer `POST /client/v1/lead-orders` does not create a priced line. Activate backfills kind/mode/qty only.
- **Root cause:** Collapse heuristic is “has pricing snapshot,” not “this is the CSV path.”
- **Smallest fix:** Treat activated `orderKind=pay_per_lead` + `fulfillmentMode=pooled_matching` like priced orders for chrome.

### D2 — Stage 2b quantity does not follow the selected order

- **Repro (code):** `useState("1")` for `pplQty`; `selectOrder()` never sets it. Priced *create* does set qty; selecting an existing portal order does not.
- **Root cause:** Local form state not bound to order.
- **Smallest fix:** On select/activate, `setPplQty(String(order.requestedQuantity ?? order.leadVolume ?? 1))`.

### D3 — Niche placeholder / catalog mismatch

- **Repro (code):** Create placeholder `VET`; onboarding placeholder `Veteran, Trucker`; selection `nicheKey: { equals: input.nicheKey.trim(), mode: "insensitive" }`. `Veteran` ≠ `vet`.
- **Root cause:** Free-text profile fields reused as order/inventory keys.
- **Smallest fix:** Shared niche enum on the three forms.

### D4 — FOWB release adapter drops `customerNotification`

- **Repro (code):** `clientPplMarkSpreadsheetDelivered` types a result without `customerNotification`. API `markSpreadsheetDelivered` returns it. Success card has identities/timestamp only.
- **Root cause:** UI type narrower than API.
- **Smallest fix:** Pass through and render the status.

### D5 — FO urgent `?status=` is ignored

- **Repro (code):** `front-office-summary.service.ts` href `/front-office/orders?status=submitted`; `front-office/orders/page.tsx` reads only `role`.
- **Root cause:** Link added; page never consumed the query.
- **Smallest fix:** Initialize `statusFilter` / `reviewFilter` from searchParams.

No P0 safety defect required a code change to finish this validation.

---

## 12. Files / scope

This PR adds this report only (plus harness evidence JSON if the rerun rewrites `docs/validation/customer-journey-e2e-mvp-evidence.json`).

No product code. No migrations. No flag changes. No production.

---

## 13. Risks and follow-up dependencies

- Parallel lanes: Portal owns `/portal` catalog/placeholders; Quality/C.O.C. owns FOWB chrome; Auth/Account owns invite/password. Do not implement across lanes in this validation PR.
- If inventory for the first customer is not `vet`/`trucker` aged NC-style stock, selection fails even with correct tokens — that is data, not this journey.
- Previous PPL runbook (`docs/demo/ppl-aged-inventory-beta-runbook.md`) still describes “Confirm Delivery” in places; FOWB is now **Approve & Release**. Alex should follow §6 here for the *customer-submitted* path, and the older runbook for *priced FOWB-created* orders.

---

## 14. Report checklist (AGENTS.md)

- **Root cause / rationale:** API journey is closed on master; operator UX still requires Sam-shaped knowledge at portal password, niche tokens, and FOWB forks.
- **Files changed:** this document (and evidence JSON if regenerated).
- **Tests:** connected harness 42/0; focused API 98/0; focused portal/operator UI 104/0.
- **Migrations:** none.
- **Risks:** first solo Alex attempt fulfills the wrong order or ships qty 1.
- **Follow-ups:** §7 items 1–5; Auth/Account invite if product rejects shared password.
