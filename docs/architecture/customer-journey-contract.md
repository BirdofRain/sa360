# Customer Journey Contract (Discovery Audit)

Status: proposed contract (docs only — no production behavior change)  
Audit base: `origin/master` @ `96f197db2712a3fdd7e0697da475e17853bbe15f`  
(`Show customer order fulfillment and linked leads on portal order detail` #87)

This document is the agreed design contract for the first complete customer-facing
SA360 journey. It audits what exists today and specifies how later work should
attach **without collapsing** account, order, payment, fulfillment, and delivery
into one giant status.

**Out of scope for this document and for the first implementation wave**

- Stripe / card charging / invoices / amount reconciliation
- Auth redesign (per-user passwords, memberships, SSO)
- Production deploys or production data changes
- Automatic fulfillment or automatic release
- A new email provider

**Later, without redesigning this journey**

- Stripe can write `paymentConfirmationStatus = confirmed`
- A trusted-order policy can auto-release a reviewed package
- Invite email can replace the current out-of-band password share

---

## 1. Design principle

Keep five independent lifecycle dimensions. Do **not** invent a combined enum
such as `PAYMENT_CONFIRMED_AND_APPROVED_AND_FULFILLING`.

| Dimension | Existing source of truth | Collapse risk |
| --- | --- | --- |
| A. Account / onboarding | `ClientAccount.status` | Do not reuse order `needs_setup` as account state |
| B. Order | `LeadOrder.status` + timestamps | Do not encode payment or package release here |
| C. Payment | **Missing** | Do not infer from `approvedAt` or line prices |
| D. Fulfillment | Committed `LeadAllocation` count vs requested qty | Do not use `LeadOrder.fulfilledQuantity` for customers |
| E. Delivery package / release | `LeadDeliveryExportPackage.spreadsheetDeliveredAt` | Generated ≠ released. Download ≠ released |

Existing architecture already separates A, B, D, and E. Payment is the only
dimension that does not exist yet.

---

## 2. Current architecture (what exists on master)

### 2.1 Client / account

**Tenant:** `ClientAccount` (`prisma/schema.prisma`)

| Field | Role today |
| --- | --- |
| `clientAccountId` | Slug identity, operator-chosen |
| `clientDisplayName` | Business name |
| `status` | `onboarding` (default) \| `active` \| `paused` \| `archived` — **manual** |
| `portalEnabled` | Must be `true` for portal API tenant resolution |
| `portalDisplayName` | Optional portal greeting name |
| `portalLoginEmail` | Unique login identity (case-insensitive match) |
| `portalPasswordHash` | Optional per-customer scrypt hash. `NULL` = shared env password fallback |
| `portalPasswordSetAt` | When the per-customer hash was stored (invite PR) |
| `portalSessionEpoch` | Default `0`. Increment to revoke that tenant's portal cookies |
| `primaryNicheKeys` / `primaryProductTypes` | Operator-set JSON arrays |
| `notes` | Operator notes |

There is **no** `onboardingComplete`, `invitedAt`, `firstLoginAt`,
`notificationEmail`, or `billingEmail`.

**How Alex creates a client today**

1. Admin C.O.C. `/clients` → `ClientCreateForm`
2. `POST /admin/v1/clients` (`createClientAdmin`)
3. Defaults: `status = onboarding`, `portalEnabled = false`
4. Portal fields are **not** collected on create

**How portal access is created**

1. On `/clients/[clientAccountId]`, operator enables portal and sets `portalLoginEmail`
2. Client signs in at `/portal/login` with that email + **shared env password**
   (`CLIENT_PORTAL_LOGIN_PASSWORD`) while `portalPasswordHash` is null. After a
   later invite PR sets a per-customer hash, the env password is rejected for that
   tenant. See `docs/architecture/portal-per-customer-password-foundation.md`.
3. Session cookie `sa360_client_portal_session` (v2 embeds tenant)
4. Optional deprecated `?access=` env code (`CLIENT_PORTAL_ACCESS_CODE`)

**Invitations:** do not exist. No token model, no expiry, no send API, no
acceptance tracking. Admin copies `/portal/login` and shares the password
out of band.

**Profile / order readiness**

- Portal `/portal/account` is **read-only**
- No `PATCH /client/v1/*` profile write
- `POST /client/v1/lead-orders` does **not** check `ClientAccount.status`,
  portal completeness, or GHL/cutover readiness
- Closest “ready” concept is the computed admin cutover report
  (`GET /admin/v1/clients/:id/cutover-readiness`) — not persisted

**GHL / delivery config** (`ClientGhlDestination`) is operator onboarding for
live CRM delivery. It is **not** the customer onboarding profile and must stay
separate.

### 2.2 Order creation / approval

**Model:** `LeadOrder` — comment in schema: “no billing yet.”

`LeadOrderStatus`:

`draft` → `submitted` → `needs_setup` | `needs_compliance` → `ready` → `active`
→ `paused` | `completed` | `canceled`

Timestamps: `submittedAt`, `approvedAt` (set when status becomes `ready`),
`activatedAt` (when `active`), `pausedAt`, `completedAt`, `canceledAt`.

**Client create:** `POST /client/v1/lead-orders` → `createClientLeadOrder()`

- Hardcodes `status = submitted`, `createdByRole = client`, `submittedAt = now`
- Snapshots `clientDisplayName`
- Does **not** set `orderKind`, `fulfillmentMode`, `requestedQuantity`,
  pricing, or `LeadOrderLine`
- Validation: niche/campaign/CRM/destination are free-text; states must be
  canonical US codes; `leadVolume` 1–1,000,000

**Admin create/edit**

- `POST /admin/v1/lead-orders`, `PATCH /admin/v1/lead-orders/:id`
- PATCH may jump to any status (no transition guard)
- Front Office `/front-office/orders` can create orders and PATCH status
- Portal `/portal/orders` is **list/detail only** — create helper exists in
  `client-portal-api/server.ts` but no portal page calls it
- Fulfillment Ops `POST /admin/v1/fulfillment-ops/client-lead-orders` creates
  priced PPL orders with `LeadOrderLine` (`unitPriceCents`, `lineTotalCents`)

**Approval today:** `ready` + `approvedAt` is the approval equivalent. Portal
copy already says submitted orders are waiting for SA360 review.

**Activation today:** `active` + `activatedAt` is what starts fulfillment.
Shadow match, PPL selection, and ops `allocationReady` all require
`status === active` plus LF2/PPL config (`orderKind`, `fulfillmentMode`,
`requestedQuantity`).

**Safety:** a raw client `submitted` order cannot accidentally fulfill — it
never enters `listActiveFulfillmentOrders()`. Residual risk: admin PATCH can
skip `ready` and jump to `active`. Even then, missing LF2 fields usually
block allocation.

**Pricing:** quoted on `LeadOrderLine` only (PPL ops path). Not payment.
Customer must not control status, account id, routing, orderKind, prices,
or fulfillment counters.

### 2.3 Payment

**Nothing persisted.** No Stripe code, no invoice model, no
`paymentStatus` / `amountDue` / `paidAt`.

What exists and must not be reused as payment:

| Artifact | Actual meaning |
| --- | --- |
| `LeadOrder.approvedAt` / `ready` | Operational approval |
| `LeadOrderLine.unitPriceCents` | Quote snapshot |
| Planning `paymentStatus` placeholder | UI mock only |
| PPL beta runbook checkbox | Paper ops, not queryable |

### 2.4 Fulfillment (committed-allocation contract — do not change)

Customer-safe presenter: `lead-order-fulfillment.present.ts`

| Field | Meaning |
| --- | --- |
| `fulfillmentAvailable` | `requestedQuantity > 0` **or** at least one committed allocation |
| `requestedQuantity` | `LeadOrder.requestedQuantity` if set, else `leadVolume` |
| `fulfilledQuantity` | Count of `LeadAllocation` with `status = committed` |
| `remainingQuantity` | `max(requested - committed, 0)` |
| `status` | `not_started` \| `in_progress` \| `fulfilled` |

Reserved holds are **not** delivered. `LeadOrder.fulfilledQuantity` is
**not** customer-safe (PPL `markSpreadsheetDelivered` commits allocations
without incrementing that counter).

**Eligibility:** `LeadOrder.status === active` + LF2/PPL configuration.  
**Completion (customer):** committed count ≥ requested.  
**Order `completed`:** manual admin PATCH only — not auto-set.  
**Partial fulfillment:** normal (`in_progress`, line `partially_fulfilled`).  
**Spreadsheet batches:** allowed; export commit is per current allocation set.  
**Trigger:** PPL export/delivery is **manual**. Shadow worker allocates
shadow rows only — it does not export or release.

**Order-linked leads:** `GET /client/v1/lead-orders/:id/leads` — committed
allocations only, tenant-scoped, masked. Portal order detail already shows
this (#87).

### 2.5 Spreadsheet / export package

**Carrier:** `LeadDeliveryExportPackage` (immutable CSV bytes in Postgres).

Operator path (Fulfillment Ops, feature-flagged):

1. Selection commit → `LeadAllocation` `reserved`
2. Export preview (ephemeral)
3. Export commit → new package row (`spreadsheetDeliveredAt` null)
4. Admin download CSV (does **not** deliver)
5. `markSpreadsheetDelivered` + phrase `MARK SPREADSHEET DELIVERED`
   → sets `spreadsheetDeliveredAt`, writes `BuyerDeliveredIdentity`,
   promotes allocations `reserved|delivering` → `committed`

**Generated ≠ delivered is already enforced for portal leads.** Export
commit cannot surface leads to the customer. There is **no** customer CSV
download route.

Packages are immutable. A new `idempotencyKey` creates a new row. There is
no `SUPERSEDED` / `FAILED` / version pointer. Download itself is not
durably audited.

### 2.6 Notifications

| Mechanism | Exists? | Fit |
| --- | --- | --- |
| Resend transport (`transactional-email.ts`) | Yes | Reuse; env-gated no-op if unset |
| Support-ticket notify | Yes — only caller | Pattern to copy |
| Portal invite email | No | |
| Order / delivery email | No | |
| `FulfillmentOutbox` | Yes | Wrong grain (per source lead, shadow work) |
| BullMQ email queue | No | Optional later for retries |

Recipient for a future “Your order is ready”: `ClientAccount.portalLoginEmail`.

### 2.7 Customer portal (`/portal`)

| Route | Today |
| --- | --- |
| `/portal/login` | Email + shared password |
| `/portal` | Performance dashboard + count tiles — **not** next-action |
| `/portal/orders` | List only |
| `/portal/orders/[orderId]` | Detail, next-step copy, fulfillment progress, linked leads |
| `/portal/leads`, `/portal/leads/[leadId]` | Delivered-lead read model |
| `/portal/account` | Read-only identity + trust cards |

No `/portal/welcome`, `/portal/account/setup`, or `/portal/orders/new`.
Do not add those routes until a distinct multi-step flow needs them.

Honest next-action data today:

| Desired card | Honest now? |
| --- | --- |
| Complete your account | Partial — `status=onboarding` + trust cards; no in-portal write |
| Place your first order | Partial — empty list; API exists; no portal UI |
| Payment confirmation pending | **No** |
| Order approved | Yes — `ready` + `approvedAt` |
| Fulfillment in progress — N of M | Conditional — only when `fulfillmentAvailable` |
| Finalizing delivery | Weak — no client signal for “package built, not released” |
| Download spreadsheet | **No** |

### 2.8 Admin C.O.C. / Front Office / Fulfillment Ops

Alex currently operates **three shells**:

| Surface | Lifecycle role |
| --- | --- |
| C.O.C. `/clients` | Create client, enable portal, GHL/cutover |
| Front Office `/front-office` | Urgent tasks (“N new order(s) awaiting review”), create/PATCH orders |
| `/fulfillment-ops` | Activate, select, export, download, mark delivered |

`/action-center` is a GHL dialer, not this journey. `/review` and Command
Center “clients needing attention” are empty placeholders.

| Desired operator queue | Today |
| --- | --- |
| NEW CLIENT → Send invite | Partial — configure + copy URL |
| ONBOARDING INCOMPLETE → Follow up | Partial — scattered cutover/trust screens |
| ORDER SUBMITTED → Confirm payment | **Missing** |
| PAYMENT CONFIRMED → Approve order | Partial — PATCH to `ready`, no payment prereq |
| FULFILLING → Monitor | Yes, fragmented across FO / FOWB / lead-fulfillment |
| DELIVERY READY FOR REVIEW → Review spreadsheet | Yes, inside selected-order workbench |
| REVIEW COMPLETE → Approve & Release | Partial — `markSpreadsheetDelivered` (different name) |
| RELEASED → No action | Partial — field exists, no queue, no customer notify |

---

## 3. Recommended lifecycle state machines

Use existing enum names wherever they already fit. Add **one** new
dimension (payment). Do not add a sixth mega-status.

### A. Account / onboarding

Reuse `ClientAccount.status`. Do **not** add `onboardingComplete`.

| State | Meaning | Who triggers | Prerequisite | Customer wording | Manual today? | Later automation |
| --- | --- | --- | --- | --- | --- | --- |
| `onboarding` (default) | Tenant exists; not ready to treat as live | Alex on create; stays until Alex marks active | Client created | “Complete your account” / “Your SA360 team is finishing setup” | Yes | Invite acceptance + required profile fields could propose `active` |
| Portal provisioned (derived) | `portalEnabled` + `portalLoginEmail` set | Alex on client detail | Client exists | “Check your email / sign in at the portal” | Yes (copy URL) | Invite email + token acceptance |
| `active` | Operator-ready tenant (ready to order) | Alex PATCH | Profile + portal login known enough to operate | “Place an order” | Yes | Policy: required fields present |
| `paused` / `archived` | Stop new work | Alex | — | “Account paused — contact SA360” | Yes | Billing/churn later |

**INVITED → ONBOARDING → READY TO ORDER (derived, not a new enum)**

| Journey label | Derivation |
| --- | --- |
| INVITED | `portalEnabled && portalLoginEmail` (MVP). Formal invite tokens are a later Auth/Account add. |
| ONBOARDING | `status === onboarding` |
| READY TO ORDER | `status === active` |

Do not block order create on GHL cutover. Cutover is CRM-live readiness, not
“allowed to request aged/PPL leads.”

### B. Order

Reuse `LeadOrderStatus`. Conceptual `APPROVED` = existing `ready`.
Conceptual `FULFILLING` = existing `active`.

| State | Meaning | Who triggers | Prerequisite | Customer wording | Manual today? | Later automation |
| --- | --- | --- | --- | --- | --- | --- |
| `draft` | Saved, not sent | Future client save; unused on client POST | Account exists | “Draft — not submitted” | Unused on client path | Autosave |
| `submitted` | Order request in queue | Client or admin create | Schema-valid request | “Submitted — your SA360 team will review it” | Client POST already does this | — |
| `needs_setup` / `needs_compliance` | Blocked on account or policy | Alex PATCH | `submitted` | Existing portal copy | Yes | Trust/compliance checks |
| `ready` | **Approved** (`approvedAt`) | Alex (or combined button) | Review done; see payment rule below | “Approved — fulfillment starts after activation” | Yes | Trusted-client auto-approve |
| `active` | **Fulfillment eligible** (`activatedAt`) | Alex / fulfillment-ops activate | `ready` + LF2/PPL fields | “In fulfillment” | Yes | Auto-activate after approve for trusted PPL |
| `paused` | Hold | Alex | `active` | “Paused” | Yes | — |
| `completed` | Closed | Alex PATCH | Usually fulfilled | “Complete” | Yes | Auto when fulfilled **and** released |
| `canceled` | Dead | Alex | — | “Canceled” | Yes | — |

**Required new guard (implementation, not a new enum):**
`submitted` must not jump to `active`. Activation requires `ready` (or an
explicit admin override with audit). Client-created orders stay `submitted`
until Alex acts.

Customer fulfillment progress stays on the **fulfillment presenter**, not
on `LeadOrder.status`.

### C. Payment

**New dimension.** Smallest honest answer to “Has payment been confirmed?”

| State | Meaning | Who triggers | Prerequisite | Customer wording | Manual today? | Later automation |
| --- | --- | --- | --- | --- | --- | --- |
| `pending_confirmation` | Default for payable orders | System on create | Order exists | “Payment confirmation pending” | N/A (unpersisted) | Stripe webhook → `confirmed` |
| `confirmed` | Alex attested Stripe outside SA360 | Alex (admin API) | Order exists | “Payment confirmed” | Yes (paper) | Stripe `payment_intent.succeeded` |
| `not_required` | Comp / demo / retainer / internal | Alex | Policy | Hidden or “No payment due” | Yes | Product rule on `orderKind` |

**Persistence (when Auth/Account is authorized to migrate):**

- `LeadOrder.paymentConfirmationStatus` enum
- `paymentConfirmedAt` / `paymentConfirmedBy` (optional audit)

Do **not** store Stripe IDs, amounts due/paid, or invoices in this wave.

**Payment confirmation and order approval stay separate internal
operations** even if C.O.C. ships one “Confirm Payment & Approve” button.
That button must call two writes:

1. `paymentConfirmationStatus = confirmed`
2. `status = ready` (`approvedAt`)

Activation (`active`) remains a third operation.

Recommended MVP rule: Alex may approve (`ready`) only when payment is
`confirmed` or `not_required`. Product can relax this; the fields must
still be independent.

### D. Fulfillment

Reuse the customer presenter. Do not add a new order-level fulfillment enum.

| State | Meaning | Who triggers | Prerequisite | Customer wording | Manual today? | Later automation |
| --- | --- | --- | --- | --- | --- | --- |
| unavailable | No structured tracking yet | — | Client order with only `leadVolume`, zero commits | “Detailed fulfillment progress is not available yet” | Yes | Backfill `requestedQuantity` on approve/activate |
| `not_started` | Tracking on; 0 committed | Activation | `active` + requested qty | “Fulfillment has not started” | Yes | Shadow/PPL selection |
| `in_progress` | Partial committed | Allocation commit / release | `active` | “17 of 25 delivered” | Yes (PPL batches) | Live LF2 commit |
| `fulfilled` | committed ≥ requested | Last commit | — | “All requested leads delivered” | Yes | Auto |

Partial fulfillment is first-class. Do not change committed-allocation
read semantics.

### E. Delivery package / release

Reuse `LeadDeliveryExportPackage`. Map conceptual states onto existing
columns. Do **not** add a package status enum until supersession is needed.

| State | Meaning | Who triggers | Prerequisite | Customer wording | Manual today? | Later automation |
| --- | --- | --- | --- | --- | --- | --- |
| GENERATING | Preview in memory; no row | Alex export preview | Reserved/exportable allocations | Hidden or “Preparing delivery” (only if we later persist a job) | Yes | Worker job |
| READY_FOR_REVIEW | Package row exists; `spreadsheetDeliveredAt IS NULL` | Alex export commit | Exportable allocations | Hidden (operator-only) | Yes | Auto-export after full reserve |
| RELEASED | `spreadsheetDeliveredAt` set | Alex “Approve & Release” (today: `markSpreadsheetDelivered`) | Package reviewed | “Your order is ready — download spreadsheet” | Yes | Trusted auto-release after QA |
| SUPERSEDED / FAILED | Not modeled | — | — | — | — | Add only if regeneration becomes common |

**Critical rule:** a generated package must not be customer-visible until
release. Today this is true for portal **leads**. A future customer
**download** route must gate on `spreadsheetDeliveredAt != null` (and
tenant + order scope).

**Semantic remapping (product, not schema):** treat
`markSpreadsheetDelivered` as **Approve & Release**. That action already
(1) attests the package, (2) commits allocations, (3) writes buyer
identities. That is the correct release boundary for “these leads are now
the customer’s.” Relabel in C.O.C.; do not add a second release timestamp
unless product later splits “visible in portal” from “spreadsheet
attested.”

---

## 4. Exact customer-visible journey

| Step | Actor | Exists today? | Attach point |
| --- | --- | --- | --- |
| 1. Alex creates a client | Admin | **Yes** | `/clients` → `POST /admin/v1/clients` |
| 2. Client receives portal invitation | Admin + email | **No** (manual share) | Keep provisioning on client detail; add email later |
| 3. Client completes onboarding / profile | Client | **No** write path | Prefer `/portal/account` before adding `/portal/account/setup` |
| 4. Client submits an order request | Client | API **yes**, portal UI **no** | CTA on `/portal/orders` (and dashboard); `POST /client/v1/lead-orders` |
| 5. Alex handles Stripe outside SA360 | Alex | Outside system | No SA360 Stripe |
| 6. Alex marks payment confirmed | Admin | **No** | New admin operation; FO urgent task |
| 7. Alex approves the order | Admin | **Yes** (`ready`) | Same PATCH, now after payment |
| 8. SA360 fulfills the order | Ops | **Yes** (manual PPL/LF2) | `/fulfillment-ops` after `active` |
| 9. SA360 generates the spreadsheet | Ops | **Yes** | Export commit |
| 10. Alex reviews the spreadsheet | Ops | **Yes** | Admin CSV download |
| 11. Alex clicks Approve & Release | Ops | **Yes** (different label) | `markSpreadsheetDelivered` |
| 12. Client is notified order is ready | Email | **No** | Resend + `portalLoginEmail` after release |
| 13. Client downloads the released spreadsheet | Client | **No** | New client download gated on release; keep `/portal/orders/[orderId]` |
| 14. Order stays visible with history + delivered leads | Client | **Partial** | Already on order detail + `/portal/leads` |

Dashboard next-action priority (first match wins), once data exists:

1. Account `onboarding` → Complete your account
2. `active` and zero orders → Place your first order
3. Latest order payment `pending_confirmation` → Payment confirmation pending
4. Latest order `ready` → Order approved
5. Package READY_FOR_REVIEW (operator-only; customer: “Finalizing delivery” if we expose a safe flag)
6. Fulfillment `in_progress` → “Fulfillment in progress — N of M delivered”
7. Package RELEASED → “Your order is ready — Download spreadsheet”
8. Else performance dashboard as today

---

## 5. Gap matrix

| Capability | Currently exists? | Source of truth | Missing? | Backend work | Portal work | C.O.C. work |
| --- | --- | --- | --- | --- | --- | --- |
| Client creation | Yes | `ClientAccount` + `POST /admin/v1/clients` | Portal fields not on create form | None required | — | Optional: collect login email on create |
| Invite | No (manual provision) | `portalEnabled` + `portalLoginEmail` + env password | Token, email, acceptance | Auth/Account if tokens; else notify-only | Login already exists | “Send invite” action (copy or email) |
| Onboarding state | Partial | `ClientAccount.status` | Persisted checklist / first login | None if we keep manual `active` | Next-action on `/portal` | Onboarding queue from `status=onboarding` |
| Profile | Partial (admin write) | `ClientAccount` fields | Client edit; notification prefs | Optional `PATCH /client/v1/account` | `/portal/account` form | Already editable |
| Order submission | API yes, portal no | `POST /client/v1/lead-orders` → `submitted` | Catalog validation; portal form | Tighten enums later | `/portal/orders` create CTA | FO form already exists |
| Payment confirmation | **No** | — | Entire dimension | Additive `LeadOrder` payment fields + admin POST | Read-only wording | Confirm action / combined button |
| Order approval | Yes | `status=ready`, `approvedAt` | Transition guard; payment prereq | Guard `submitted ↛ active` | Copy already honest | Queue of `submitted` + payment confirmed |
| Fulfillment | Yes | `active` + LF2/PPL ops | Client orders lack LF2 fields until ops activate | Activate path must backfill `requestedQuantity` | Progress UI exists | Workbench exists |
| Fulfillment progress | Yes (gated) | Committed allocation presenter | Legacy orders show placeholder | Set `requestedQuantity` on activate | Already mapped | — |
| Order-linked leads | Yes | `GET /client/v1/lead-orders/:id/leads` | — | Preserve contract | Order detail exists | — |
| Spreadsheet generation | Yes | `LeadDeliveryExportPackage` commit | Customer-visible generating state | None | None | Workbench exists |
| Delivery-package persistence | Yes | `LeadDeliveryExportPackage` | Version/supersede pointer | Not for MVP | — | List packages on an order |
| Internal review | Yes | Admin download of committed package | Named queue | List undelivered packages | — | “Ready for review” queue |
| Release | Yes (ops name differs) | `spreadsheetDeliveredAt` + `markSpreadsheetDelivered` | Customer download gate; relabel | Client download route | Download button after release | Relabel to Approve & Release |
| Customer download | **No** | — | Entire route | `GET /client/v1/lead-orders/:id/exports/:exportId/download` gated on release | Button on order detail | — |
| Notification | Transport only | Resend + support-ticket pattern | Delivery-released + invite templates | `notifyDeliveryReleased` after release | Optional in-app banner | Trigger is release, not a new ops screen |
| Journey dashboard | **No** | FO summary KPIs + order/fulfillment fields | Next-action presenter | Optional `GET /client/v1/journey` or derive in BFF | `/portal` hero | C.O.C. queue lens on same states |

---

## 6. Recommended PR sequence

This audit PR is **docs only**. Do not implement B–F here.

Decompose by **lifecycle dimension**, not by “build the whole journey.”
Portal lane owns `/portal` UX. Auth/Account owns any migration. Quality /
C.O.C. owns operator queues. API contract extensions stay additive.

### PR 0 — this document

- **Purpose:** Freeze the five-dimension contract and gap list
- **Apps:** docs only
- **Migration:** no
- **Risk:** low

### PR A — Lifecycle / foundational contract (BUILD FIRST)

- **Purpose:** Make payment a real, separate field; stop illegal status jumps; expose admin confirm/approve as two operations (optional combined route that calls both)
- **Apps:** `apps/api` (types, `lead-order.service`, admin routes, presenters); `packages/shared` if enums are shared
- **Models / routes:** `LeadOrder.paymentConfirmationStatus` (+ timestamps); `POST /admin/v1/lead-orders/:id/confirm-payment`; existing PATCH status with transition rules (`submitted`/`needs_*` → `ready` → `active`)
- **Frontend:** none required; optional FO status labels
- **Tests:** payment default on client/admin create; confirm-payment does not set `ready`; approve does not set payment; `submitted → active` rejected; client presenter never exposes admin payment actor; fulfillment presenter unchanged
- **Dependencies:** this contract
- **Migration:** **yes** (additive, Auth/Account lane)
- **Risk:** medium (touches order write path; must not change client create response shape except additive payment visibility if product wants it — default **admin-only**)

### PR B — Client onboarding (no auth redesign)

- **Purpose:** Honest INVITED / ONBOARDING / READY TO ORDER using existing `ClientAccount` fields
- **Apps:** `apps/api` (optional account presenter), `apps/admin-coc` portal + clients
- **Models / routes:** reuse `ClientAccount`; optional `PATCH /client/v1/account` for display-safe fields only (`portalDisplayName`, niches if product allows). **No invite-token table unless product insists.**
- **Frontend:** `/portal/account` remaining read-only is OK if Alex completes profile; if client edit is required, edit on `/portal/account` (do not add `/portal/account/setup` unless the form is multi-step)
- **C.O.C.:** “Send invite” = enable portal + copy login URL (and later email)
- **Tests:** portal still rejects `portalEnabled=false`; account PATCH cannot change `status` or `portalEnabled`
- **Dependencies:** none on PR A
- **Migration:** no (unless invite tokens — avoid)
- **Risk:** low–medium

### PR C — Order request flow

- **Purpose:** Let the client submit an order request in the portal as **intake**, not commerce
- **Apps:** `apps/admin-coc` portal; optionally tighten `apps/api` catalog validation
- **Models / routes:** existing `POST /client/v1/lead-orders` (server-proxied only)
- **Frontend:** CTA on `/portal` + `/portal/orders`; form can live on `/portal/orders` without `/portal/orders/new`
- **Customer must not send:** status, prices, `orderKind`, routing, admin notes
- **Tests:** create stays `submitted` + `pending_confirmation`; portal empty state CTA; no browser-held portal API key
- **Dependencies:** safer after PR A (so submit cannot be activated without approval); can start UI against current API
- **Migration:** no
- **Risk:** medium (shallow free-text validation)

### PR D — Manual payment + approval (C.O.C.)

- **Purpose:** Operator queue: submitted → confirm payment → approve (`ready`) → activate (`active`)
- **Apps:** `apps/admin-coc` Front Office + optional C.O.C. queue; `apps/api` already from PR A
- **Frontend:** `/front-office/orders` drawer: Confirm Payment, Approve, optional combined button; do not hide the two operations in the API
- **Tests:** combined action writes both fields; `not_required` path; FO urgent task includes payment-pending
- **Dependencies:** PR A
- **Migration:** no additional
- **Risk:** low if PR A landed

### PR E — Delivery package + customer release download

- **Purpose:** Keep generated packages operator-only until release; let the client download the released CSV
- **Apps:** `apps/api` client download route; `apps/admin-coc` portal order detail + fulfillment-ops label
- **Models / routes:** reuse `LeadDeliveryExportPackage`; `GET /client/v1/lead-orders/:id/exports/:exportId` (metadata) + `/download` **only if** `spreadsheetDeliveredAt` set and tenant matches
- **Frontend:** order detail download button; C.O.C. relabel Mark Delivered → Approve & Release; optional “ready for review” list of undelivered packages
- **Tests:** download 404 before release (same as wrong tenant); 200 after; export commit still does not create `BuyerDeliveredIdentity`; committed-allocation presenter unchanged
- **Dependencies:** none on payment; product-complete journey wants PR D so we do not release unpaid orders
- **Migration:** no
- **Risk:** medium (new customer file download; must not leak unreleased CSV)

### PR F — Notifications + next-action dashboard

- **Purpose:** Email “Your order is ready” and a next-action hero on `/portal`
- **Apps:** `apps/api` notify service (copy `support-ticket-notify.service.ts`); `apps/admin-coc` `/portal`
- **Models / routes:** hook after successful release; optional `GET /client/v1/journey` or BFF derive
- **Frontend:** `/portal` hero; no `/portal/welcome` unless the hero is insufficient
- **Tests:** notify skipped when Resend unset; recipient is `portalLoginEmail`; hero priority table; no email send in CI
- **Dependencies:** PR E for honest “download spreadsheet”; PR A/D for payment pending; PR B/C for account/order CTAs
- **Migration:** no
- **Risk:** low

**Do not start PRs B–F in this audit.** PR A is the first implementation PR
because later UI will lie (payment) or skip gates (activation) without it.

---

## 7. Is a migration actually necessary?

| Need | Migration? | When |
| --- | --- | --- |
| This audit / contract | **No** | Now |
| Honest payment confirmation | **Yes — small additive on `LeadOrder`** | PR A |
| Invite tokens / per-user passwords | No for MVP | Only if product rejects shared-password provisioning |
| Onboarding-complete flag | **No** — use `ClientAccount.status` | — |
| Delivery package model | **No** — reuse `LeadDeliveryExportPackage` | — |
| Release vs generated | **No** — `spreadsheetDeliveredAt` | — |
| Customer download | **No** | PR E, route-only |
| Notifications | **No** | PR F, hook + Resend |
| SUPERSEDED / FAILED package enum | No for MVP | If regeneration becomes common |

Do **not** add a migration merely because invite tokens or Stripe objects
are missing.

---

## 8. Risks / dangerous coupling

1. **Inferring payment from `approvedAt` or line prices** — would block
   Stripe automation later and lie on comps/retainers.
2. **Admin PATCH status with no transition guard** — `submitted → active`
   skips approval; fulfillment still usually blocked by missing LF2
   fields, but ops activate backfills those fields.
3. **Two order-create paths** — flat client/FO intake vs priced
   fulfillment-ops PPL. Portal must stay on the intake path; operators
   configure/activate on the ops path.
4. **`LeadOrder.fulfilledQuantity` vs committed allocations** — PPL
   release does not increment the stored counter. Customer reads must
   stay allocation-based.
5. **`markSpreadsheetDelivered` does three jobs** (attest, commit
   allocations, write identities). Relabel as release; do not split
   without a product reason.
6. **Shared portal password + shared API key** — acceptable behind the
   BFF; never call `/client/v1` from the browser with the portal key.
7. **Free-text niche / campaign / CRM / destination** — customers can
   submit unsellable requests; ops must normalize before activation.
8. **Cutover readiness ≠ ready to order** — do not block PPL order
   requests on GHL live-delivery checklists.
9. **Multiple export packages per order** — without SUPERSEDED, customer
   download must pick the latest **released** package (or list released
   ones), never an undelivered newer commit.
10. **Command Center / `/review` emptiness** — do not build a fourth ops
    shell; extend Front Office urgent tasks + Fulfillment Ops.

---

## 9. Product decisions (Sam / Alex)

1. **Must payment be confirmed before approve (`ready`), or only before
   activate (`active`)?** Contract default: before `ready`.
2. **Is a combined “Confirm Payment & Approve” button enough for MVP, if
   the API keeps two operations?** Recommended: yes.
3. **Should retainer / demo orders use `not_required` by default based on
   `orderKind`, or always start `pending_confirmation`?** Recommended:
   client portal PPL requests default `pending_confirmation`; Alex sets
   `not_required` explicitly.
4. **Does the client need to edit profile in the portal, or does Alex
   finish onboarding in C.O.C.?** If Alex finishes, skip client PATCH
   (smaller PR B).
5. **Is shared-password + copied login URL acceptable for the first
   invite, or is a real invite token required before any customer sees
   this journey?** Tokens imply Auth/Account migration and are not
   required by this contract.
6. **Should customer download be the released CSV, or is “released linked
   leads” enough for v1?** Journey step 13 asks for spreadsheet download;
   leads-only is already shipped (#87) and can ship before PR E.
7. **After release, should order auto-`completed`?** Recommended: no —
   keep `completed` a manual/ops close so replacements can still attach.
8. **Should client-created orders show payment-pending copy in the
   portal before PR A lands?** No — do not invent the state in UI.
9. **Which package is “the” download when several released batches
   exist?** Recommended: list all released packages on the order; do not
   hide earlier batches.
10. **May Alex activate (`active`) in the same motion as approve, or
    must fulfillment-ops remain the activation seat?** Recommended:
    C.O.C. can approve; fulfillment-ops still activates so LF2/PPL
    fields get set on the path that knows how.

---

## 10. Lane ownership for follow-on PRs

| PR | Primary lane | Notes |
| --- | --- | --- |
| A | Auth/Account (migration) + API | Coordinate presenters with Portal/Quality |
| B | Portal + Auth/Account if any account write | No auth redesign |
| C | Portal | API already exists; do not invent a second create |
| D | Quality / C.O.C. + Front Office | Consumes PR A |
| E | API + Portal + Fulfillment Ops UI | Preserve generated ≠ released |
| F | API notify + Portal | Reuse Resend; no new provider |

If a follow-on task needs another lane’s owned files, stop that portion
and record the dependency (`docs/development/PARALLEL_AGENT_WORK.md`).
