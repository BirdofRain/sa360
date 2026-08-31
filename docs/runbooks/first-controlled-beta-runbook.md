# SA360 First Controlled Beta Runbook

**Audience:** Sam (supervisor) and Alex (operator)  
**Operating verdict on current `origin/master`:** **READY WITH MANUAL GUARDRAILS.**  
**Path:** customer-submitted aged PPL order → external payment → Front Office confirm/approve → Fulfillment Ops activate/reserve/export → operator review → Approve & Release → portal CSV download.  
**Code baseline this runbook was written against:** `origin/master` @ `6fab3f5f10caf9a54df473375388d527e8e5837f` (includes customer-journey PRs #96, #98, #99, #100). Connected API harness on that lineage: **42/42**. The harness is not a substitute for the operator checks below.

**This runbook is documentation / operations only.**

- Do **not** deploy.
- Do **not** change production configuration from this document.
- Do **not** activate NextGen `inventory_only`.
- Do **not** activate LF2 execution or GHL live delivery.
- Do **not** make production writes except the normal operator clicks already required to fulfill one paying customer (confirm payment, approve, activate, reserve, export, Approve & Release). If a precondition is wrong, **STOP** and escalate to Sam. Do not “fix” it by flipping env flags.

**Safety rules that never change during first beta**

| Rule | Meaning |
| --- | --- |
| Generated ≠ Released | `Commit Export` and internal `Download CSV` do **not** make the file customer-visible. |
| Customer must not see an export before Approve & Release | Portal download appears only after release. |
| Use the existing customer-submitted order | Do **not** create a second order. |
| Ignore LF2 Stages 3–6 | Pooled / PPL CSV path is Stages 2 → 2b → 2c only. |
| Stage 2b quantity defaults to `1` | Manually change it to the customer’s ordered quantity **before** preview/reserve. |
| No NextGen `inventory_only` | Leave NextGen at unset / `capture_only`. |
| No LF2 / live GHL | Header must show **LF2 EXEC OFF** and **GHL CANARY OFF**. |

---

## 1. Preconditions

Verify every row **before** taking payment or promising delivery. Record values in the worksheet at the bottom of this section.

### How to read the two columns

- **VERIFIED AUTOMATICALLY** — the current operator UI or a public read-only health endpoint shows the fact. Still write the observed value down.
- **MUST BE MANUALLY VERIFIED** — no trustworthy in-product control exists, or the UI can lie. Sam or Alex must check DigitalOcean / env / inventory / the customer worksheet and initial the row.

This runbook does **not** authorize changing any production env var, running `prisma migrate deploy` against production, or opening GHL cutover.

### 1.1 Production migration verification

| Checkpoint | Method | Class | Pass if |
| --- | --- | --- | --- |
| Latest journey migrations applied | DigitalOcean **PRE_DEPLOY** migrate job last successful run for this app | **MUST BE MANUALLY VERIFIED** | Job succeeded after these migration folders exist on the deployed SHA: `20260827210000_lead_order_payment_confirmation_v1`, `20260828180000_delivery_release_customer_notify_v1` |
| API can reach Postgres | `GET https://<api-domain>/health/db` → `{ "ok": true, "db": "connected" }` | **VERIFIED AUTOMATICALLY** | HTTP 200 |
| Front Office payment dimension exists | `/front-office/orders` shows Review pills **Submitted / Payment pending**, **Payment confirmed**, **Payment not required** | **VERIFIED AUTOMATICALLY** | Pills render (proves payment fields are in the running API) |
| Do **not** run | `prisma migrate deploy`, `prisma migrate dev`, `prisma db push` against production | — | **STOP** if anyone proposes this during beta |

If `/front-office/orders` has no payment pills, or Confirm Payment returns an unknown-field / 500 error: **STOP**. Migrations are not verified. Do not take payment.

### 1.2 Deployed component SHAs

| Component | Method | Class | Pass if |
| --- | --- | --- | --- |
| API | `GET https://<api-domain>/health` → `commitSha` / `commitShort` / `buildSource` | **VERIFIED AUTOMATICALLY** (when `SA360_BUILD_COMMIT_SHA` is set) | SHA is recorded; `buildSource` is `SA360_BUILD_COMMIT_SHA` when bindable is configured |
| Worker | DigitalOcean worker component commit (or worker logs). `/health` is API-only. | **MUST BE MANUALLY VERIFIED** | Worker SHA recorded; instance running, not crash-looping |
| Admin C.O.C. / portal | DigitalOcean `sa360-admin-coc` component commit | **MUST BE MANUALLY VERIFIED** | SHA recorded |
| Journey code present | Compare recorded SHAs to GitHub `master` containing #96, #98, #99, #100 | **MUST BE MANUALLY VERIFIED** | All three components are on that lineage or later **without** extra live-delivery flag changes |

If API `commitSha` is `null`: SHA observability is missing. **STOP** promising a specific build. Sam records the DigitalOcean UI commit instead. Do not set env vars from this runbook.

Recorded values:

```text
API /health commitSha:     ______________________________
API commitShort:           __________
API buildSource:           ______________________________
Worker SHA:                ______________________________
admin-coc SHA:             ______________________________
Verified by / date:        ______________________________
```

### 1.3 Delivery runtime mode

| Checkpoint | Where | Class | First-beta pass |
| --- | --- | --- | --- |
| Fulfillment Ops header | `/fulfillment-ops` always shows badges **SIMULATION ONLY** and **LIVE DISABLED** | Display only — **not proof** | See warning below |
| Fulfillment Ops runtime line | Banner: `Runtime: {NODE_ENV}.` | **VERIFIED AUTOMATICALLY** (value only) | Record the printed runtime. Typical production print is `production`. This is `NODE_ENV`, **not** GHL adapter mode. |
| LF2 execution | Badge **LF2 EXEC OFF** (green/success tone) vs **LF2 EXEC ON** (danger) | **VERIFIED AUTOMATICALLY** | Must be **OFF** |
| GHL canary | Badge **GHL CANARY OFF** vs **GHL CANARY ON** | **VERIFIED AUTOMATICALLY** | Must be **OFF** |
| Direct-delivery / GHL adapter mode | `/direct-delivery-demo` “Delivery runtime mode” | **MUST BE MANUALLY VERIFIED** if that page is opened | Must **not** be a live canary. **Do not execute** anything on that page. |
| GHL allowlists | `SA360_LF2_GHL_ALLOWED_*` and direct-delivery allowlists | **MUST BE MANUALLY VERIFIED** in DigitalOcean (read-only) | All `SA360_LF2_GHL_ALLOWED_*` unset / empty. Do not add this beta customer to any live allowlist. |

**STOP — unsafe UI:** `/fulfillment-ops` **always** paints **SIMULATION ONLY** and **LIVE DISABLED**, even if **LF2 EXEC ON** or **GHL CANARY ON**. Trust the LF2 / GHL badges and DigitalOcean env, not the two hardcoded banners.

If **LF2 EXEC ON** or **GHL CANARY ON**: **STOP**. Do not fulfill. Do not turn flags off from this runbook — escalate to Sam.

### 1.4 PPL / LF2 flags

PPL CSV fulfillment **requires** selection + export already enabled. This section is a **checkpoint**, not permission to enable them.

| Flag | Expected for this path | Where operator can see it | Class |
| --- | --- | --- | --- |
| `SA360_PPL_SELECTION_ENABLED` | exactly `"true"` | Stage 2b info banner text only. **No header badge.** Preview/reserve fail closed if off. | **MUST BE MANUALLY VERIFIED** in DigitalOcean; confirm in UI by a successful **Selection Preview** on a non-customer rehearsal order **or** by Sam reading env |
| `SA360_PPL_CSV_EXPORT_ENABLED` | exactly `"true"` | Stage 2c “Generated ≠ released” banner text only. Export fails if off. | **MUST BE MANUALLY VERIFIED** |
| `SA360_PPL_REPLACEMENT_ENABLED` | unset or not `"true"` | Stage 2d titled **Replacement fulfillment — Beta restricted** | **VERIFIED AUTOMATICALLY** if that restricted panel is what you see |
| `SA360_LF2_EXECUTION_ENABLED` | unset / `false` | **LF2 EXEC OFF** | **VERIFIED AUTOMATICALLY** |
| `SA360_LF2_GHL_CANARY_ENABLED` | unset / `false` | **GHL CANARY OFF** | **VERIFIED AUTOMATICALLY** |
| C.O.C. **Feature Flags** (`/flags`) | static placeholder (`VOICE_ENABLED`, etc.) | **Not a source of truth** | Ignore for this beta |

If selection or export is not `"true"`: **STOP**. Escalate to Sam. Do not flip the flag as part of taking a customer.

If replacement is unexpectedly enabled: **STOP** using Stage 2d. Do not run replacements on the first beta order.

### 1.5 NextGen stage

| Checkpoint | Method | Class | Pass if |
| --- | --- | --- | --- |
| `SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE` | DigitalOcean API component env, read-only | **MUST BE MANUALLY VERIFIED** | Unset **or** `capture_only` |
| Admin UI | None. Stage is not shown in C.O.C. | — | Do not infer from inventory counts |

Allowed first-beta values: unset, `capture_only`.  
**Forbidden:** `inventory_only`, `normalize_route_proof`, `shadow_fulfillment`, `live_canary`.

If the value is `inventory_only` or later: **STOP**. Do not change it from this runbook.

### 1.6 Notification / Resend state

| Checkpoint | Method | Class | Pass if |
| --- | --- | --- | --- |
| `RESEND_API_KEY` set | DigitalOcean API env, read-only | **MUST BE MANUALLY VERIFIED** | Recorded yes/no |
| `SA360_TRANSACTIONAL_EMAIL_FROM` set | Same | **MUST BE MANUALLY VERIFIED** | Recorded yes/no |
| Operator release UI shows sent / skipped / failed | `/fulfillment-ops` after Approve & Release | **Not available** | Treat notify result as **unknown** |
| Portal login email on the client | `/clients/{id}` **Portal login email** | **VERIFIED AUTOMATICALLY** | A real customer email is saved |

Both Resend vars must be set **and** `portalLoginEmail` must be valid for automated “Your SA360 order is ready” mail to have any chance of sending. If either Resend var is missing, the release still succeeds and the API records notify as **failed** (transport skipped). The operator UI does **not** show that.

**Operating rule:** after every first-beta Approve & Release, complete **§9 B (manual fallback)** unless Sam has independently confirmed a `sent` result from API/logs. Do not send anything while reading this precondition section.

```text
RESEND_API_KEY present:                 [ ] yes  [ ] no
SA360_TRANSACTIONAL_EMAIL_FROM present: [ ] yes  [ ] no
portalLoginEmail on client:             ______________________________
Notify plan:                            [ ] automated attempted + manual confirm
                                        [ ] manual-only (default if either Resend var is no)
```

### 1.7 Inventory sufficiency

| Checkpoint | Method | Class | Pass if |
| --- | --- | --- | --- |
| Supply exists for niche + states + age | `/lead-inventory` summary tiles + **state-by-age matrix** | **VERIFIED AUTOMATICALLY** (counts) | Available count for each promised state is ≥ promised quantity **or** Sam has accepted a documented partial |
| Authoritative pre-commit check | Fulfillment Ops **Stage 2b → Selection Preview** (after the order is `active`) | **VERIFIED AUTOMATICALLY** | Requested = Selected, Shortfall = 0, scan complete = yes, scan ceiling = ok |
| Scan limit | Stage 2b **SEARCH INCOMPLETE** / `scan_limit_reached` | **VERIFIED AUTOMATICALLY** | Must **not** appear. Commit / Reserve stays disabled if it does. |

Do **not** promise delivery from Front Office Pipeline Studio (`/front-office/pipeline-studio`). That explorer is not the reservation source of truth.

If matrix available < promised quantity and the commercial deal requires exact fill: **STOP**. Do not take payment.

### 1.8 Customer / niche / state eligibility

| Checkpoint | Class | Pass if |
| --- | --- | --- |
| `clientAccountId` slug is the intended tenant (not a display-name lookalike) | **MUST BE MANUALLY VERIFIED** | Worksheet §2 matches `/clients/{id}` |
| Stored **Primary niches** token is an inventory key (see §3), not English (“Veteran”) | **MUST BE MANUALLY VERIFIED** | Example that matches current aged inventory: `vet` |
| Stored **Primary products** token is the internal product key | **MUST BE MANUALLY VERIFIED** | First-beta convention: `aged_leads` |
| States are canonical US codes the customer is allowed to buy | **MUST BE MANUALLY VERIFIED** | Codes match the commercial agreement |
| Lead type / freshness on the **order** is aged PPL CSV, not Fresh / Live transfer / GHL live | **MUST BE MANUALLY VERIFIED** after the customer submits | Portal **Freshness** = `Aged leads` |
| Customer is not on a live GHL allowlist for this order | **MUST BE MANUALLY VERIFIED** | No cutover / live destination work for this beta |

### 1.9 Precondition sign-off

```text
All automatic checks observed:     [ ] ____/____/____  (Alex)
All manual checks initialed:       [ ] ____/____/____  (Sam)
Payment may be taken:              [ ] yes   [ ] NO — STOP
```

---

## 2. Beta Customer Definition

Fill this **before** client setup. Do not invent commercial values. Leave a line blank if not yet agreed.

```text
=== FIRST CONTROLLED BETA — CUSTOMER WORKSHEET ===

Customer:                    ______________________________
Client account ID (slug):    ______________________________   (lowercase a-z, 0-9, _)
Display name:                ______________________________
Portal login email:          ______________________________

Niche:                       ______________________________   (internal token; first-beta example: vet)
                             customer wording: ____________   (example: Veteran — do not store this)
Lead type:                   [ ] Aged leads   [ ] other — STOP if not Aged leads
Product token:               ______________________________   (first-beta example: aged_leads)
States:                      ______________________________   (canonical US codes)
Quantity:                    ______
Price per lead:              $______
Total:                       $______
Inventory age:               [ ] 1–3 mo (COMMERCE_1_3_MO)
                             [ ] 3–6 mo (COMMERCE_3_6_MO)
                             [ ] 6–9 mo (COMMERCE_6_9_MO)
                             [ ] 9–12 mo (COMMERCE_9_12_MO)
                             [ ] 12+ mo (COMMERCE_12_MO_PLUS)
                             [ ] other — write exact key: ______________
Replacement policy:          [ ] duplicate-only, not used on first delivery
                             [ ] other (describe): ______________________
Delivery method:             [ ] Portal secure CSV after Approve & Release
                             [ ] other — STOP (first beta is portal CSV only)
Expected delivery date:      ______________________________

External payment reference:  ______________________________   (Stripe / invoice / other — outside SA360)
SA360 order number:          ______________________________   (fill after customer submits)
SA360 order id:              ______________________________

Operator (Alex):             ______________________________
Supervisor (Sam):            ______________________________
Date prepared:               ______________________________
```

---

## 3. Client Setup

Exact Alex click sequence in Admin C.O.C.

### 3.1 Sign in

1. Open Admin C.O.C. `/login`.
2. Sign in with the operator password (`ADMIN_COC_PASSWORD`).
3. Confirm you are in the production C.O.C. host you intend (check the browser origin).

**STOP** if the host is staging, preview, or local.

### 3.2 Find or create `ClientAccount`

**Find existing**

1. Nav: **Clients & Subaccounts** (`/clients`).
2. In the table, match **both** display name **and** `clientAccountId` slug to §2.
3. Click the display name → `/clients/{clientAccountId}`.

**STOP** if two rows look similar. Do not guess. Confirm the slug with Sam.

**Create only if no row exists**

1. On `/clients`, section **New client**.
2. **Client account ID** — required. Pattern `[a-z][a-z0-9_]*`. Use the slug from §2. This cannot be treated as a display name.
3. **Display name** — required. Use the worksheet display name.
4. **Primary niches (comma-separated)** — type the **internal token**, not the placeholder.
   - Ignore the field placeholder `VET` only if your worksheet token is different; first-beta convention is `vet` (case-insensitive for inventory match).
   - **Do not** type `Veteran`.
5. **Primary products (comma-separated)** — type the **internal token**.
   - Ignore the placeholder `Final Expense`.
   - First-beta convention: `aged_leads`.
   - **Do not** type `Aged leads` here. Portal **Freshness** uses `Aged leads` later; this field is a product token.
6. Click **Create client**.
7. You land on `/clients/{clientAccountId}`. Defaults: status **Onboarding**, portal **off**.

**STOP** if create fails or the URL slug does not match §2.

**Ignore** the `/clients` footer about a VET Final Expense GHL pilot (subaccount + pipeline + routing rule). That is a different path. First beta does **not** configure live GHL delivery.

### 3.3 Onboarding fields on the client detail

Page banner: **Config only — no delivery**. Saving here does not send GHL, sheets, or live delivery.

**Client profile**

1. Confirm **Client account ID** (read-only) matches §2.
2. Confirm **Display name**.
3. Confirm **Primary niches** = worksheet token (`vet`, not `Veteran`).
4. Confirm **Primary products** = worksheet token (`aged_leads`, not `Aged leads` / `Final Expense`).
5. **Status** — leave **Onboarding** until portal email is saved, then set **Active / Ready to order** (see §3.5).
6. Click **Save profile** if you changed anything.

**Internal token warnings (read before the customer logs in)**

| Stored token (required) | Customer-visible label (portal may pretty-print) | Do not store |
| --- | --- | --- |
| `vet` | Veteran | `Veteran`, `Vet Life`, `vet_fex` unless Sam confirms inventory actually uses that key |
| `trucker` / `nurse` / `mortgage` | Trucker / Nurse / Mortgage | English sentences |
| `aged_leads` | Aged leads (pretty-print) | `Final Expense`, `Aged leads` as the **product** token |

Inventory selection matches `LeadOrder.nicheKey` to inventory `nicheKey` (case-insensitive). If the customer later types **Veteran** into portal **Lead focus**, the next order’s `nicheKey` becomes `Veteran` and Stage 2b can return no inventory. **Alex must keep the stored tokens as tokens.**

### 3.4 Portal enablement

On the same client detail, **Portal** section:

1. Check **Portal enabled**.
2. **Portal display name** — optional greeting. Safe to leave blank (falls back to display name).
3. **Portal login email** — the customer’s email from §2. This is the login identity **and** the release-email recipient.
4. Confirm **Portal login URL** shows `{this C.O.C. origin}/portal/login`.
5. Click **Copy portal login URL**. Button toggles to **Copied**.
6. Click **Save portal settings**.
7. Reload the page. Confirm checkbox stays on, email is still correct, badge is not **Disabled** because of paused/archived status.

There is **no** C.O.C. control that provisions, displays, or copies a customer password.

Helper text on this page (current): portal password is server env `CLIENT_PORTAL_LOGIN_PASSWORD`.

### 3.5 `readyToOrder` verification

`readyToOrder` is **not** a field on the admin page. It is true only when `ClientAccount.status === active`.

Admin label: **Active / Ready to order**.

**Preferred first-beta path (Alex finishes setup):**

1. Tokens and portal email already saved.
2. Status → **Active / Ready to order**.
3. **Save profile**.
4. Status label reads **Active / Ready to order**.

**Alternate path (customer finishes setup):** customer opens `/portal/account`, fills **Account name**, **Lead focus**, **Product types**, clicks **Finish account setup**. Only use this if Alex has **pre-filled** `vet` and `aged_leads` and has told the customer **not to rewrite those tokens in English**.

Customer `/portal/account` when ready: banner **Account setup complete** — “You're ready to place an order.”

**STOP** if status is still **Onboarding** and you expect the customer to order. Portal **Place order** is blocked (**Complete your account**).

**STOP** if status is **Paused** or **Archived**.

### 3.6 Current credential-sharing manual step

SA360 does not email an invite and does not show a password.

1. Alex copies **Portal login URL** (`/portal/login`).
2. Alex confirms **Portal login email**.
3. Sam (or whoever can read DigitalOcean **admin-coc** env, read-only) retrieves `CLIENT_PORTAL_LOGIN_PASSWORD`.
4. Share URL + email + that password **out of band** (existing operator channel). Do not paste the password into client **Notes**, chat screenshots in the ticket, or this worksheet file in git.
5. Tell the customer: email + password from the SA360 team; button on the login page is **Continue to dashboard**.

If `CLIENT_PORTAL_LOGIN_PASSWORD` is unset, login shows: “Sign-in is not configured yet. Contact your SA360 team for access, or use your invite link if you received one.” **STOP**. Do not invent a password in C.O.C. Escalate to Sam.

Optional deprecated shortcut `CLIENT_PORTAL_ACCESS_CODE` (`/portal?access=…`) is **not** the first-beta invite path. Do not use it unless Sam explicitly says to.

### 3.7 Client-setup STOP conditions

| Condition | Action |
| --- | --- |
| Wrong slug / wrong existing client | **STOP**. Do not enable portal on the wrong tenant. |
| Niches/products stored as English words | **STOP**. Correct to tokens, **Save profile**, then continue. |
| Portal enabled without login email | **STOP**. Automated notify will skip/fail; customer cannot be identified at login. |
| Status set Active before tokens are correct | **STOP**. Customer can order with a bad catalog. |
| Temptation to open Delivery Config / GHL Connections / cutover | **STOP**. Not this beta. |
| Delete client | **STOP**. Never delete a paying-customer tenant during beta. |

---

## 4. Customer Order

The customer places the order in the portal. Alex does **not** create it.

### 4.1 Coach the customer (or sit with them)

1. Open the copied `/portal/login`.
2. **Email** = portal login email. **Password** = shared env password.
3. **Continue to dashboard**.
4. If account is already Active with tokens set: go to **Orders** → place a request (`/portal/orders/new`).
5. Form — **Configure request**:

| Field | What to enter | Default trap |
| --- | --- | --- |
| **Lead type** | Token from account niches (`vet` shown as Veteran) | Fallback list appears only if niches were empty — includes unrelated verticals |
| **Product** | `aged_leads` if shown | Hidden if Alex left products empty |
| **Quantity** | Worksheet quantity | Draft default **100** |
| **Freshness** | **Aged leads** | Draft default **Fresh leads** — **wrong for this beta** |
| **CRM** | Leave the listed option (often `GHL Starter + SA360 AI`) | This is **label metadata only**. It does **not** start GHL live delivery. Do not then go configure GHL. |
| **Delivery destination** | Listed option or **Account CRM** | Same — not a live GHL write |
| **States** | Worksheet codes only (max 20) | — |
| **Notes** | Optional; max 2000 | — |

6. **Review request** → confirm quantity, **Aged leads**, states, lead type.
7. **Submit order request**.

### 4.2 What the customer should see after submit

Success panel:

- Title: **Order request received**
- Copy: “We will confirm payment and approve your order before fulfillment begins.”
- **Request** = `orderNumber` (example shape `LO-####`)
- **Status** = **Submitted**
- **Payment** = **Awaiting payment confirmation**
- Links: **View order**, **Back to orders**

Write `orderNumber` and order id (from the view-order URL `/portal/orders/{id}`) onto §2.

### 4.3 Expected state transitions (do not skip)

Keep payment and order status **separate**. Do not invent a combined mental status.

| Step | `LeadOrder.status` | `paymentConfirmationStatus` | Who | What Alex should see |
| --- | --- | --- | --- | --- |
| Customer submit | `submitted` | `pending_confirmation` | Customer | Front Office Review pill **Submitted / Payment pending**. Drawer payment **Payment pending**. Customer: **Submitted** + **Awaiting payment confirmation**. |
| External money collected | `submitted` | `pending_confirmation` | Outside SA360 | **No SA360 change yet.** |
| Confirm Payment | `submitted` | `confirmed` | Alex, Front Office | Success text **Payment confirmed.** Pill **Submitted / Payment confirmed**. Status still **Submitted**. **Approve** becomes available. |
| Mark payment not required (comps only) | `submitted` | `not_required` | Alex, only if Sam says the order is not payable | **Payment marked not required.** Pill **Submitted / Payment not required**. |
| Approve | `ready` | unchanged (`confirmed` or `not_required`) | Alex | **Approved — ready for fulfillment**. Violet banner. Link **Open Fulfillment Ops**. Pill **Approved / Ready**. Status **Ready**. Customer: approved / waiting for fulfillment (not a download). |
| Activate | `active` | unchanged | Alex, Fulfillment Ops only | Selected order **Status ACTIVE**. Badge **ACTIVE** (allocation ready). Qty (req) = `leadVolume`. |

Unused on this happy path: `draft`, `needs_setup`, `needs_compliance`, `paused`, `completed`, `canceled`. If you see them: **STOP** and diagnose.

### 4.4 STOP if displayed state does not match

| You expected | You see | Action |
| --- | --- | --- |
| `submitted` + payment pending | No new row / different client name | **STOP**. Do not create a replacement order. Find the existing one (filter Client / Review queue). |
| Payment pending | Already **Payment confirmed** and you did not confirm | **STOP**. Ask Sam who confirmed and whether money actually arrived. |
| After Confirm Payment | Status jumped to `ready` or `active` without Approve | **STOP**. Refresh. If still wrong, escalate. Do not Activate. |
| After Approve | Banner missing or status not **Ready** | **STOP**. Do not open Fulfillment Ops to force Activate. |
| After Approve | Amber: **Payment confirmed, approval failed.** | **STOP**. Payment is confirmed; approval is not. Fix the listed error before fulfillment. |
| Freshness | Order shows **Fresh leads** or **Live transfer** | **STOP**. Do not fulfill as aged PPL. Do not “just reserve aged leads anyway” without Sam. |
| Quantity | Portal quantity ≠ worksheet | **STOP**. Resolve with the customer before payment confirm. |

Never click Confirm Payment, Approve, Activate, Reserve, or Approve & Release a second time “to see if it works” without reading the current state.

---

## 5. Payment

SA360 does **not** charge cards, create invoices, or reconcile Stripe.

1. Collect payment **outside** SA360 (existing billing process). Record the external reference on §2.
2. Only after money is actually confirmed, Alex opens **Front Office → Lead Ordering** (`/front-office/orders`).
   - Subtitle: “Confirm payment and approve submitted orders. Fulfillment Ops activates after approval.”
3. Review queue default: **Needs review or approved**.
4. Narrow with **Submitted / Payment pending** and Client filter = worksheet display name.
5. Click the table row (columns: Order, Client, Niche, States, Volume, Review, Status, Submitted).
6. Confirm the drawer is **this** customer, **this** `orderNumber`, **this** quantity, **Aged leads**, correct states.

**Confirm Payment (preferred first-beta sequence — two clicks, two facts):**

1. Click **Confirm payment** (not the combined button, unless Sam wants one motion).
2. Expect: **Payment confirmed.** Status remains **Submitted**.
3. **STOP** if the notice is an error. Do not Approve.
4. Click **Approve**.
5. Expect: **Approved — ready for fulfillment** + violet banner + **Open Fulfillment Ops**.

**Combined button:** **Confirm Payment & Approve** runs confirm then approve. Use only if the drawer still shows payment pending **and** you have already verified external payment. If you see **Payment confirmed, approval failed.** — payment landed, approval did not. **STOP.** Do not Activate. Do not click the combined button again without reading the error.

**Mark payment not required:** only for Sam-approved comp / internal / demo. Do **not** use it to skip a paying customer.

**Do not** use **Create order (admin)** on this page for a customer who already submitted.

**Do not** treat `ready` / `approvedAt` / line prices as proof of payment. Only `paymentConfirmationStatus = confirmed` (or an explicit `not_required`) is the SA360 payment attestation.

---

## 6. Fulfillment

This section is for a **customer-submitted existing order** only.

### 6.1 DO

1. From the Front Office violet banner, click **Open Fulfillment Ops**  
   (`/fulfillment-ops?orderId={that order id}`).  
   Or: nav **Fulfillment Ops** → Stage 2 dropdown **Select an existing order…** → choose `{orderNumber} — {nicheKey} — {status}`.
2. **Immediately** confirm identity (the dropdown does **not** show client name):
   - Banner line: `Selected order: {orderNumber} ({status})`
   - Stage 2 card: niche / states / qty
   - Prefer arriving via `?orderId=` from Front Office so you do not pick a neighbor `LO-` number
3. Confirm header: **LF2 EXEC OFF**, **GHL CANARY OFF**. (Ignore hardcoded **SIMULATION ONLY** / **LIVE DISABLED** as proof.)
4. Status must already be **READY**. Click **Activate order**.
5. After activate, Stage 2 card must show **Status ACTIVE** and badge **ACTIVE**.  
   Qty (req / reserved / fulfilled) requested side must equal the customer quantity (`leadVolume` is copied into `requestedQuantity` on activate if it was empty).  
   Backfill that Activate performs when missing: `orderKind = pay_per_lead`, `fulfillmentMode = pooled_matching`, `requestedQuantity = leadVolume`, 7-day fulfillment window.
6. **Stage 2b — Selection Preview / Commit Reserve**
   - Customer-submitted orders are **not priced**. The commerce-bucket field is **editable** and defaults to **all five** aged keys:  
     `COMMERCE_1_3_MO,COMMERCE_3_6_MO,COMMERCE_6_9_MO,COMMERCE_9_12_MO,COMMERCE_12_MO_PLUS`
   - The quantity field placeholder is **Requested quantity** and the default value is **`1`**. It does **not** auto-fill from the order.
   - **Change quantity to the worksheet / order quantity before anything else.**
   - **Change the bucket field to the single key from §2.** Do not leave all five keys unless Sam explicitly approved a mixed-age package.
   - Click **Selection Preview**.
   - Read tiles: Requested, Eligible, Selected, Shortfall, Scan complete, Scan ceiling, Excluded same buyer.
   - **STOP** if SEARCH INCOMPLETE / `scan_limit_reached`. That is not a shortage. Do not reserve.
   - **STOP** if Shortfall > 0 and the deal requires exact fill. Do not reserve a silent partial.
   - **STOP** if Selected ≠ worksheet quantity.
   - Only then click **Commit / Reserve Leads** (destructive / red).
7. **Stage 2c — Review / Approve & Release**
   - Click **Export Preview**. Note Rows, Allocations, Schema, Niche, columns.
   - Rows must equal reserved/selected count.
   - Click **Commit Export**. Badge must become **Spreadsheet ready for review**. Copy: customer cannot see this package yet.
   - Click **Download CSV** (operator-only). Review using §7.
   - Do **not** click **Approve & Release** until §7 and §8 pre-checks pass.

### 6.2 DO NOT

| Do not | Why |
| --- | --- |
| Use **Client Lead Order (CSV / manual fulfillment)** / **Create Client Lead Order** | Creates a **second** `pay_per_lead` order. Wrong path for a portal-submitted order. |
| Use Front Office **Create order (admin)** | Same duplicate-order risk. |
| Use **Lead Fulfillment Overview**, LF2 Stages 3–6, or **Show diagnostics** | Eligibility preview / Prepare + reserve candidate / Run simulated delivery are **Legacy / Simulation Operations**, not the PPL CSV path. |
| Use Stage 2d replacement | Hidden / restricted. Not first delivery. |
| Leave Stage 2b quantity at default **1** | You will reserve/export/release one lead. |
| Leave Stage 2b buckets at the five-bucket default | You may mix ages the customer did not buy. |
| Treat internal **Download CSV** as delivery | Generated ≠ Released. |
| Open `/direct-delivery-demo` to “send” the leads | Live GHL path. Forbidden. |
| Activate while status is still **Submitted** | API refuses (`submitted_cannot_activate`). Approve first. |

### 6.3 After each fulfillment action — expected UI

| Action | Expect | STOP if |
| --- | --- | --- |
| Activate | **ACTIVE**, requested qty = customer qty | **NOT ALLOCATION READY** or status not ACTIVE |
| Selection Preview | Requested = customer qty; Selected = Requested; Shortfall 0; scan complete yes | qty still 1; scan limit; no inventory; wrong niche/states |
| Commit / Reserve | Selected persists; reserved count on the order card moves up | Error banner; reserved 0; reserved ≠ intended |
| Export Preview | Rows = reserved; niche matches token | Row mismatch; mixed niche |
| Commit Export | **Spreadsheet ready for review**; SHA / row count / schema tiles | Package missing; customer portal already shows **Download spreadsheet** (should be impossible — escalate) |

---

## 7. Spreadsheet Review

Operator-only CSV from Stage 2c **Download CSV**. Filename is server-authored (client / order number / niche / states / bucket / row count). Open the file locally. Do not email it to the customer yet.

Thread C may replace this checklist. Anything not proven on current master is marked **PENDING DELIVERY QUALITY AUDIT**. Do not guess a pass.

| Check | First-beta instruction | Status |
| --- | --- | --- |
| Expected row count | Count data rows (exclude header). Must equal Stage 2c **Rows**, reserved/selected count, and §2 quantity (or Sam-approved partial). | Operator must verify |
| No accidental duplicate buyer delivery | Stage 2b tile **Excluded same buyer** is the in-product prior-delivery exclusion. Visually scan phone/email in **this** CSV for obvious repeats. | Partial — deeper buyer-history audit is **PENDING DELIVERY QUALITY AUDIT** |
| Generated date | `lead_date` column exists on `buyer_csv_v2`. Confirm every row has a date and dates are plausible for the purchased age bucket. | Column required; age-plausibility bar is **PENDING DELIVERY QUALITY AUDIT** |
| Customer-facing lead type | `niche` column present; value matches the order token (e.g. `vet` / VET). Portal pretty-print is separate. | Column required; display-copy audit is **PENDING DELIVERY QUALITY AUDIT** |
| Data completeness | Base columns must exist: `first_name`, `last_name`, `phone`, `email`, `state`, `lead_date`, `niche`, plus `beneficiary`, `coverage_amount` on v2. Niche extras (VET: `branch_of_service`, `disability_rating`) may be blank. | Header/schema from export preview; fill-rate thresholds **PENDING DELIVERY QUALITY AUDIT** |
| Sort order | Do not assume a required sort. | **PENDING DELIVERY QUALITY AUDIT** |
| CSV opens correctly | File opens as a table (not one-column garbage). Encoding/Excel/Sheets quirks are not certified here. | Smoke-open required; full client-tool matrix **PENDING DELIVERY QUALITY AUDIT** |
| Customer identity / order metadata | Filename and Stage 2c context panel (**Export for {client} · {orderNumber}**) match §2. CSV body is leads, not a second customer’s rows. | Operator must verify |
| Schema version | Stage 2c **Schema** tile. New exports are `buyer_csv_v2` per existing PPL runbook. | Verify tile; do not rewrite historical v1 packages |
| SHA-256 | Stage 2c shows a SHA prefix. Re-download if you need to confirm the same bytes after review. | Record prefix on §12 |

**STOP** if row count ≠ reserved count, niche/states do not match §2, you recognize another customer’s leads, or the file will not open. Do **not** Approve & Release. Do **not** “try export again” without recording why (new `Commit Export` creates another package; the unreleased one is still not customer-visible).

---

## 8. Approve & Release

Irreversible for this buyer: writes `BuyerDeliveredIdentity` and excludes those identities from future orders for the **same** client.

### 8.1 Before clicking

From the **Approve & Release** dialog (title **Approve & Release**), read every line:

| Dialog field | Must match |
| --- | --- |
| Client | §2 display name / slug |
| Order | §2 `orderNumber` |
| Niche | Worksheet token |
| Bucket | Worksheet bucket (customer-submitted orders may show `—` if unpriced — then re-check the Stage 2b keys you actually used) |
| CSV rows | Reviewed file row count and §2 quantity (or documented partial) |

Also confirm:

- [ ] Stage 2c badge is still **Spreadsheet ready for review** (not already **Released**)
- [ ] You reviewed **this** download, not an older local file
- [ ] Portal spot-check (incognito, this customer): order exists; **Download spreadsheet** is **absent**; if the order is `active`, Delivery may say **Your spreadsheet is being finalized.** That is not a download.
- [ ] You are not releasing a rehearsal/demo order

### 8.2 Click

1. **Approve & Release**
2. Dialog opens. If any line is wrong: **Cancel**.
3. Confirm with **Approve & Release — N Lead(s)** (N = row count).  
   The UI submits the backend phrase `MARK SPREADSHEET DELIVERED` for you. Do not type it.

### 8.3 Verify after

| Check | Expect |
| --- | --- |
| Package badge | **Released** — “This spreadsheet is customer-accessible.” |
| Success panel | **Released**; Identities recorded = N; Evidence note present; Delivered timestamp; Delivered by |
| Fulfillment count | Order card reserved/fulfilled and Stage 2c rows agree with N |
| Customer portal | Same customer: **Your delivery is ready.** + **Download spreadsheet** |
| Secure download | Link downloads CSV; row count = N; same identities as operator file |
| Notification result | **Not shown in this UI.** Go to §9. |

**STOP** if badge is not Released, identity count ≠ N, or the customer portal still has no download **or** shows a download for a different order. Do not click Approve & Release again to “retry” without diagnosing (replay can be idempotent; a new export is a new package).

---

## 9. Customer Notification

Do **not** send anything while only reading this section. After a real release, use A and/or B.

### A. Automated notification available

On Approve & Release the API attempts `notifyDeliveryReleased`:

- Recipient: `ClientAccount.portalLoginEmail`
- Subject: `Your SA360 order is ready`
- Transport: Resend, only if `RESEND_API_KEY` **and** `SA360_TRANSACTIONAL_EMAIL_FROM` are set
- Durable statuses (API/DB, **not** drawn on the success panel): `pending`, `sending`, `sent`, `skipped`, `failed` (plus view-only `in_progress`, `not_released`, `no_intent` for legacy packages)

Skip reasons include missing client, missing portal email, invalid portal email.  
If Resend is unset, send returns skipped-at-transport and the durable status is recorded **failed**. Release still succeeds.

There is **no** operator Resend button and **no** sent/skipped/failed badge on Approve & Release.

Sam may confirm `sent` only via API/logs (`delivery_release.notify.sent` / package `customerReleaseNotifyStatus`). Alex must not assume the email went out because the green **Released** panel appeared.

### B. Manual fallback when notification transport is unavailable

Use this whenever §1.6 is “manual-only” **or** notify result is uncertain:

1. Do **not** attach the operator CSV to a blast email if you can avoid it. Prefer: “Your order is ready in the portal” + the same `/portal/login` URL already shared.
2. Out-of-band message to the portal login email (or the customer’s known ops contact): order number, that the spreadsheet is waiting behind login, ask them to download from the order page.
3. If the customer cannot log in, fix login first (§11). Do not send a second customer’s file.
4. Record on §12: channel, time, who notified, whether download was later confirmed.

---

## 10. Customer Verification

Use the **customer** login (or sit with them). Do not use a different tenant’s session.

| # | Check | Pass |
| --- | --- | --- |
| 1 | Login at `/portal/login` with **this** email + shared password | Dashboard loads. No “incorrect” / “not configured” |
| 2 | Orders list shows the **correct** `orderNumber` only for this customer | No other customer’s orders |
| 3 | Order detail: status/fulfillment matches released work | Delivery: **Your delivery is ready.** |
| 4 | **Download spreadsheet** works | CSV downloads; rows = released N |
| 5 | **Leads from this order** | Count = released allocations; identities match the CSV (masked in UI). Empty text “No delivered leads are linked to this order yet.” is a **FAIL** after a successful release |
| 6 | No other customer data | Other order ids / downloads 404 or “not found”; no foreign names, phones, or files |

**STOP** on any fail. Treat as a tenant or release defect. Do not tell the customer to “try again” on download if the button is missing (package not released) or if they see another company’s data (escalate immediately).

---

## 11. Failure / STOP Conditions

Do not retry an irreversible action to see if it “goes through.” Diagnose first.

| STOP | How you know | What to do instead of retry |
| --- | --- | --- |
| Wrong tenant / customer | Slug, display name, login email, or `orderNumber` ≠ §2 | Close the tab. Re-open from Front Office `?orderId=`. Do not Activate / Release. |
| Unexpected runtime mode | **LF2 EXEC ON**, **GHL CANARY ON**, or DigitalOcean shows live adapter / NextGen ≠ `capture_only` | Stop fulfillment. Escalate to Sam. Do not toggle flags from this runbook. |
| Flags unexpectedly enabled | Replacement workbench fully enabled; or LF2/GHL on; or NextGen `inventory_only`+ | Same as above. Do not use the extra surface. |
| Quantity mismatch | Stage 2b Requested is `1` or ≠ worksheet; portal qty ≠ worksheet | Change Stage 2b qty **before** reserve. If already reserved wrong: **STOP**. Do not Approve & Release. Escalate (release reservations via supported path only if Sam directs). |
| Insufficient approved inventory | Preview Shortfall > 0 with scan complete; or no inventory | Do not reserve a hopeful partial unless Sam documents it. Do not take/keep payment without a new commercial agreement. |
| Duplicate delivery concern | Excluded same buyer is high; you recognize repeats in the CSV; two packages for one paid qty | Do not Release. Escalate. |
| Export row mismatch | Preview/commit rows ≠ reserved ≠ worksheet | Do not Release. Do not create a second Client Lead Order to “make up” rows. |
| Unreleased package visible | Customer sees **Download spreadsheet** before you Released | Escalate immediately (generated ≠ released violated). |
| Customer cannot access portal | Login error; portal disabled; wrong email; password env unset | Fix enablement/email/password share. Do not email the CSV to bypass login unless Sam accepts that exception and the file is re-checked for tenant. |
| Cross-tenant data visibility | Any other customer’s order, lead, or CSV | Stop the session. Escalate. Do not continue fulfillment. |
| Notify result uncertain | Green Released panel, no sent/skipped/failed | Perform §9 B. Do not click Approve & Release again to “resend.” There is no Resend UI. |
| Confirm Payment without money | Button is available whenever status is pending | **STOP**. Confirm Payment is a business attestation, not a processor. |
| Combined confirm succeeded, approve failed | Amber notice | Leave payment confirmed. Fix approval. Do not Activate. |
| Scan limit | SEARCH INCOMPLETE | Narrow states/bucket with Sam. Do not treat as shortage. Commit is disabled — do not look for another button. |
| Wrong-order dropdown | Similar `LO-` numbers | Use Front Office deep link only. |
| Second order created | New `LO-` after customer submit | **STOP**. Fulfill the **original** submitted order. Do not Release both. |

---

## 12. First Beta Closeout

Fill after customer verification. Numbers come from the order card, Stage 2b/2c tiles, and the customer download — not from memory.

```text
=== FIRST CONTROLLED BETA — CLOSEOUT ===

Customer / slug:             ______________________________
Order number / id:           ______________________________
Operator / supervisor:       ______________________________
Date closed:                 ______________________________

Requested:                   ______
Reserved:                    ______
Committed (released identities): ______
Released (package rows):     ______
Downloaded (customer confirmed): [ ] yes  [ ] no   count: ______
Customer notified:           [ ] automated sent (Sam confirmed in API/logs)
                             [ ] skipped/failed (reason): ________________
                             [ ] manual fallback (channel/time): __________
                             [ ] not notified — STOP and explain: _________
CSV schema / SHA prefix:     ______________________________
Rejected rows:               ______   (describe): ________________________
Replacements:                ______   (must be 0 unless Sam authorized)
Issues:                      ____________________________________________
Customer outcome / follow-up: ____________________________________________

Sign-off Alex:               ________________  date __________
Sign-off Sam:                ________________  date __________
```

---

## 13. Current Manual Guardrails

Everything below is still a person, not a product control.

**Depends on Sam**

- Read-only confirmation of production migrate-job success and component SHAs (worker + admin-coc).
- Read-only confirmation of DigitalOcean env: PPL selection/export, LF2/GHL off, NextGen unset/`capture_only`, Resend pair, `CLIENT_PORTAL_LOGIN_PASSWORD`.
- Authorization to take payment, accept a partial, mark payment not required, or touch reservations after a bad reserve.
- Confirmation of notify `sent` from API/logs (UI cannot).

**Depends on Alex knowing internal terminology**

- Create/profile fields: `vet`, `aged_leads` (not Veteran / Final Expense / Aged leads).
- Stage 2b commerce keys (`COMMERCE_*`) vs customer wording (“3–6 months”).
- Portal **Freshness** `Aged leads` vs product token `aged_leads`.
- Which order is the customer’s when the Fulfillment Ops dropdown omits client name.
- Ignoring Client Lead Order create, FO admin create, Stages 3–6, replacement, GHL cutover, NextGen.

**Depends on external payment**

- Money moves outside SA360. Confirm Payment is an attestation.

**Depends on manual environment verification**

- PPL badges are missing; SIMULATION ONLY is hardcoded; NextGen is invisible; `/flags` is a stub; notify status is invisible.

**Depends on manual customer communication**

- Password share (env-only).
- “Your file is ready” when Resend is unset or result is unknown.
- Sitting through portal order form defaults (quantity 100, Freshness Fresh leads).

---

## 14. Exit Criteria for “Alex-Solo Beta Ready”

Do **not** implement these here. First controlled beta proceeds with §13. Alex-solo means a paying customer can be run **without Sam on the call** because the product makes the following objectively true.

| # | Today’s manual dependency | Exit criterion (objective) |
| --- | --- | --- |
| 1 | Portal password is env-only; no C.O.C. provision/display | C.O.C. can issue or reveal a **per-customer** credential (or single-use invite) without DigitalOcean. Customer can reset it. Shared `CLIENT_PORTAL_LOGIN_PASSWORD` is not required for a new beta customer. |
| 2 | Alex must type `vet` / `aged_leads` / `COMMERCE_*` | Client setup and portal order form use customer-facing labels **bound** to those tokens. Stored values cannot silently become `Veteran`. Stage 2b bucket defaults to the **agreed single** commerce bucket, not all five. |
| 3 | Payment is outside SA360 + operator attestation | Still acceptable for Alex-solo if Confirm Payment is blocked until a recorded external reference is entered **and** Approve stays a second explicit step. Combined button must not be the only visible action. |
| 4 | Production env/SHA/NextGen/PPL must be checked in DigitalOcean | Fulfillment Ops header shows **live** PPL selection/export/replacement, LF2, GHL canary, NextGen stage, and API SHA. Hardcoded **SIMULATION ONLY** / **LIVE DISABLED** are removed or bound to real flags. `/flags` is not a stub. |
| 5 | Stage 2b quantity defaults to 1 on existing orders | Opening a customer-submitted order prefills quantity from `leadVolume` / `requestedQuantity`. Preview/reserve **blocked** while qty is 1 and order qty ≠ 1. |
| 6 | Duplicate Client Lead Order / FO create sit on the same screens | Customer-submitted orders hide or disable **Create Client Lead Order** and FO **Create order (admin)** when a submitted/approved order for that tenant is selected. |
| 7 | Fulfillment Ops dropdown omits client name | Every order option and the Stage 2 card show `clientDisplayName` + slug + `orderNumber`. |
| 8 | Notify sent/skipped/failed is invisible | Approve & Release success panel shows notify status + reason. If not `sent`, a required “I notified the customer manually” operator ack is recorded. No second Release click to resend. |
| 9 | Generated vs released can be confused | Customer download remains impossible pre-release (already true in API). Operator UI keeps a single **Released** vs **Ready for review** badge (already present). Alex-solo additionally requires a pre-release portal preview that **cannot** download. |
| 10 | Spreadsheet quality is unaudited | Thread C checklist is filled with pass/fail rules (row count, sort, completeness thresholds, open-in-Sheets). Until then, Alex-solo is **not** met for unsupervised release. |
| 11 | Inventory promise is a Sam judgment | Selection Preview for the **real** niche/states/bucket/qty can be run (or a safe dry preview) **before** payment is confirmed, without activating a paying order. |
| 12 | Customer can submit Fresh leads / default qty 100 | Portal first-beta catalog locks freshness to Aged leads and prefills the commercially agreed quantity, or Alex can reject the request in Front Office with an explicit “not aged PPL” state. |

Alex-solo is **not** met until 1, 2, 4, 5, 6, 7, 8, and 10 are true. Items 3, 9, 11, 12 may remain supervised if documented.

---

## Follow-up (not for first beta)

Do not build these while running the first customer. Listed only so they are not mixed into operating steps.

- Per-customer portal passwords or invite-token email.
- Stripe writing `paymentConfirmationStatus` (field already exists; processor does not).
- Relabel/hide Stages 3–6 and Client Lead Order create on the customer-submitted path.
- Surface `customerReleaseNotifyStatus` on the operator success panel; add a true Resend action.
- Bind Fulfillment Ops safety badges to real flags; show NextGen stage.
- Prefill Stage 2b qty/bucket from the existing order; warn when qty is still `1`.
- Thread C delivery-quality audit (sort, completeness, client spreadsheet tools).
- NextGen `inventory_only` and LF2/GHL live delivery remain **out of scope** for this beta.

---

## Related documents (do not substitute for this runbook)

- `docs/demo/ppl-aged-inventory-beta-runbook.md` — priced Client Lead Order / CSV contract (different create path).
- `docs/architecture/customer-journey-contract.md` — lifecycle dimensions (some sections predate the payment UI now on master).
- `docs/validation/customer-journey-final-regression.md` — 42/42 harness evidence.
- `docs/operations/pilot-client-cutover-runbook.md` — **GHL live cutover. Do not follow it for this beta.**
- `docs/deploy/digitalocean-app-platform.md` — `/health` SHA and migrate job (read-only use only).
