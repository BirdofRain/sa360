# Customer portal UX bug bash rerun — 2026-09-08

Validation only. No product code was changed. No production deploy. No
production writes. Rechecked the **2026-09-04 launch-blocker checklist** on
current `origin/master` after PRs **#120** and **#121**.

Prior audit: `docs/validation/customer-portal-ux-bug-bash-2026-09-04.md`
(after #117).

## Scope and method

- **Master SHA:** `49d619694e258fe123af49aa104dc8281e327211` —
  `fix(portal): make customer order status truthful (#121)`
- **Also on master since the last bash:** #118 (account-complete transition),
  #120 (remove internal lead diagnostics).
- **Product reality used:** per-customer passwords, 3/3 converted, shared
  password retired, access code retired, self-service recovery live. Retired
  migration behavior is **not** flagged as missing.
- **How walked:** local API `:3001` + Next portal `:3000`. Seeded converted
  customers in local `sa360` only (`@example.test`). Desktop ~1440×900 and
  mobile 390×844.
- **Not in scope:** redesign, CRM/AI/voice features, product implementation.

## Verdict

**A launch blocker remains.**

#120 and #121 cleared the order-detail / lead-detail honesty failures that
made those surfaces look broken. A paying agent can now see payment separately
from order status, is no longer told a spreadsheet is “being finalized” on
unpaid or completed-with-zero-released orders, and no longer sees
`InboundContactIndex` on lead detail.

**Account status is unchanged** and still dumps C.O.C. diagnostics onto a
customer who was just told setup is complete. That remains the controlled-beta
blocker.

Place-order CRM labels and Account setup placeholders were not in #120/#121
and are still customer-facing.

---

## Ranked remaining controlled-beta blockers

1. **Account status is still a C.O.C. diagnostic dump (F1, P1, still
   launch-blocking).** `/portal/account` still shows GHL Connection, Delivery
   Readiness, Required Fields, Workflow / Pipeline Config, Webhook Health
   (**Needs attention**, 0 received today), Routing Rule Readiness, Signal
   Health (**Needs attention**), Client Snapshot Readiness, and “Preview data —
   connect live sources for operational checks.” Sits under a green **Account
   setup complete** banner. Desktop and mobile.
2. **Account setup placeholders still look filled (F7, P1).** Lead focus /
   Product types still use `Veteran, Trucker` and `Final Expense, Aged`. Finish
   without typing still errors. On mobile the gray placeholders read even more
   like real values.
3. **Place order still sells GHL SKUs (F6 remainder, P1 if customers place
   their own orders).** `/portal/orders/new` CRM dropdown is still **GHL
   Starter**, **GHL Starter + SA360 AI**, **GHL Pro + SA360 routing**. List and
   detail no longer render those fields (#121).
4. **Leads list still shows operator source copy (F10/F11 remainder, P1).**
   Detail is clean (#120). List still prints **LeadCapture Webhook** under
   every campaign, and the All filter is still titled **Delivered leads**.
5. **Released spreadsheet can contradict Lead delivery counts (new residual,
   P1 if this path exists in production).** On `LO-UXR-REL`, Delivery says
   **Your delivery is ready** + **Download spreadsheet** (5 leads) while Lead
   delivery says **0 of 5 delivered / Not started**. This fixture released a
   package without committed allocations. If production release always commits
   allocations, this is fixture-only. If a CSV can be released without those
   rows, it is a remaining honesty bug.

---

## Checklist vs #120 / #121

| 2026-09-04 launch-blocker item | After #120/#121 | Rank now |
| --- | --- | --- |
| 1. Replace/hide Account status C.O.C. cards | **Unchanged.** Not in #120/#121. | **#1 remaining blocker** |
| 2. Stop “spreadsheet being finalized”; show payment; no Completed + 0 + finalizing | **Cleared on list/detail.** Unpaid → “A download is not available yet.” Completed + 0 released → “No leads have been released yet.” Payment is its own column/pill. | Cleared (see residual #5) |
| 3. Account setup placeholders + Place order after success | **Unchanged.** Placeholders still look filled. Success banner still has no Place order button. | **#2 remaining** (button is P2) |
| 4. Strip lead-detail operator warnings | **Cleared on detail.** Robert Hayes has no InboundContactIndex / Funnel / Ad / Routing. API still returns the warning; portal filters it. | Cleared on detail; list residual is **#4** |
| 5. Customer-safe order summary (GHL / CRM / destination / AI voice) | **Cleared on list/detail/needs-setup.** Place-order CRM dropdown still GHL. | **#3 remaining** (create form only) |

#118 (account-complete skeleton) shipped. Not re-timed in this bash; success
state was immediate locally, same as 2026-09-04.

---

## What #120 / #121 fixed (confirmed in UI)

- Orders list: **Status** and **Payment** are separate columns. Submitted +
  Payment pending; Completed + Payment confirmed; Canceled + No payment due.
- Unpaid `LO-UXR-PAY`: Delivery = **A download is not available yet.** No
  “spreadsheet is being finalized.” No GHL / CRM package / destination type /
  AI voice / “GHL destination is not connected.”
- Completed `LO-UXR-DONE` with no package: Delivery = **No leads have been
  released yet.** Not finalizing. Lead delivery still shows 0 of 10 / Not
  started (honest, awkward — P2).
- Released `LO-UXR-REL`: Download spreadsheet CTA works. Overview hero is
  **Your order is ready** / **Download spreadsheet**.
- Needs-setup `LO-UXR-SETUP`: no GHL destination warning.
- Lead detail: no `No InboundContactIndex snapshot found for this lead scope.`
- Foreign order/lead: generic not-found, no tenant leak.
- Empty Orders still has Place order. Auth / forgot-password / invite setup
  still work.

API still *returns* operator fields (`crmPackage`, `deliveryDestinationType`,
InboundContactIndex warning, trust card titles). The portal now hides most of
those on list/detail. Trust cards are still rendered as-is.

---

## Findings that remain (not re-filed unless status changed)

Severity: **P0** journey/security/data safety. **P1** support ticket or
meaningful confusion. **P2** polish. **P3** cosmetic.

### R1 — Account status is still C.O.C. diagnostics (was F1)

| | |
| --- | --- |
| **Page** | `/portal/account` |
| **Repro** | Sign in as a converted ready customer. Open Account. Scroll Account status. Desktop and 390px. |
| **Expected** | Customer-safe health, or hide the section. |
| **Actual** | Same eight cards as 2026-09-04. Green **Account setup complete** above **Needs attention** webhook/signal cards and mock Preview rows. |
| **Severity** | **P1 (still the launch blocker)** |
| **Recommended change** | Do not present `GET /client/v1/trust` Front Office cards on the customer Account page. |
| **Likely files** | `portal/account/page.tsx`, `portal-account-panel.tsx`, `front-office-trust-present.service.ts` |
| **PR** | **Own PR.** Highest-priority remaining Portal change. |

### R2 — Account setup placeholders look filled (was F7)

| | |
| --- | --- |
| **Page** | `/portal/account` (incomplete account) |
| **Repro** | Sign in as onboarding customer. Look at Lead focus / Product types. Click Finish account setup without typing. |
| **Expected** | Empty required fields look empty. |
| **Actual** | Placeholders `Veteran, Trucker` / `Final Expense, Aged`. Finish → “Add at least one lead focus.” / “Add at least one product type.” Mobile reads even more like filled values. |
| **Severity** | **P1** |
| **Recommended change** | Drop example placeholders or prefix “Example:”. Prefer a picker. After success, add Place order (was F8, P2). |
| **Likely files** | `portal-account-onboarding.tsx` |
| **PR** | Own PR (Account setup UX). |

### R3 — Place order CRM still uses GHL SKUs (was F6 remainder)

| | |
| --- | --- |
| **Page** | `/portal/orders/new` |
| **Repro** | Ready customer → Place order → open CRM. |
| **Expected** | Package in agent language, or omit if the agent cannot choose. |
| **Actual** | **GHL Starter** / **GHL Starter + SA360 AI** / **GHL Pro + SA360 routing**. Delivery destination can show the greeting name (“Sam”). |
| **Severity** | **P1** if beta customers place their own orders; **P2** if operators always create orders. |
| **Recommended change** | Presentation-only labels on `PORTAL_ORDER_REQUEST_CRM_PACKAGES`. |
| **Likely files** | `portal-order-request.ts`, `portal-order-request-form.tsx` |
| **PR** | Own small PR or group with copy polish. |

### R4 — Leads list still exposes LeadCapture Webhook (was F10/F11 remainder)

| | |
| --- | --- |
| **Page** | `/portal/leads` (All) |
| **Repro** | Ready customer → Leads → All. |
| **Expected** | Campaign in plain language. Title matches the filter. |
| **Actual** | Section title **Delivered leads** while All is selected. Every row subtext **LeadCapture Webhook**. Failed + **Received**. Empty All (empty account) still **No delivered leads yet**. Detail page is clean. |
| **Severity** | **P1** for list jargon + All title; empty-copy is P2. |
| **Recommended change** | Apply `portalCustomerSourceLabel` on the list. Title “Leads” on All. |
| **Likely files** | `portal-leads-list.tsx`, `portal-lead-customer.ts` |
| **PR** | Group with leftover lead-present work. |

### R5 — Released download vs 0 delivered (new residual)

| | |
| --- | --- |
| **Page** | `/portal/orders/uxrerun_20260908_ord_rel` |
| **Repro** | Open a completed order that has a released export package and zero committed allocations. Desktop and mobile. |
| **Expected** | If a spreadsheet of 5 leads is ready, Lead delivery should not say 0 / Not started. |
| **Actual** | Delivery: **Your delivery is ready** + Download. Lead delivery: **0 of 5 delivered / Not started**. Fulfillment counts committed allocations only. |
| **Severity** | **P1** if production can release without committed allocations; otherwise fixture-only. |
| **Recommended change** | Product/Portal: when a released package exists, do not show Not started / 0 delivered, or count released rowCount. Confirm the PPL release path before treating this as a must-fix. |
| **Likely files** | `portal-order-fulfillment-section.tsx`, `lead-order-fulfillment.present.ts` |
| **PR** | Own PR only after confirming the production path. Do not invent allocation writes. |

### Still deferred (unchanged, not launch-blocking)

- Invite unavailable still has no Back to sign in (F12, P2).
- Login still says **Sign in to your dashboard** / **Continue to dashboard** (F14, P2).
- Sign out still small/low-contrast (F15, P2).
- Greeting shown as **Business: Sam**; Focus duplicates Final expense (F16, P2). Orders list also stacks **Final expense** twice under Lead type.
- Overview “who acts” on needs-setup (F17) was not the hero in this fixture because a released download outranked it.
- Keyboard/focus rings (F18, P2).
- Full-page skeleton (F19, P2; #118 owns the account-complete case).

---

## Accessibility / loading / errors (spot-check)

No new P0. Login invalid credentials still `role="alert"`. Foreign 404s still
explain the resource is not on this account and offer Back. Delivery load-error
copy was not re-forced. Mobile 390px: nav did not wrap; no horizontal page
scroll on the walked list pages.

Contact masking on lead detail remains intentional buyer-safe behavior.

---

## Evidence

Local walkthrough (not production):

<img alt="Account status still shows GHL and Needs attention cards" src="/opt/cursor/artifacts/rerun_account_status_operator_cards.webp" />
<img alt="Orders list now has a Payment column" src="/opt/cursor/artifacts/rerun_orders_list_payment_column.webp" />
<img alt="Completed order no longer says spreadsheet is being finalized" src="/opt/cursor/artifacts/rerun_order_completed_zero_honest.webp" />
<img alt="Released order download ready while lead delivery says 0 of 5" src="/opt/cursor/artifacts/rerun_order_released_contradiction.webp" />
<img alt="Lead detail without InboundContactIndex" src="/opt/cursor/artifacts/rerun_lead_detail_no_inboundindex.webp" />
<img alt="Place order CRM still lists GHL packages" src="/opt/cursor/artifacts/rerun_place_order_ghl_crm.webp" />
<img alt="Account setup placeholders still look filled" src="/opt/cursor/artifacts/rerun_account_setup_placeholders.webp" />

## Tests / builds

- No product tests added (audit-only).
- Manual desktop + mobile walk against local API + portal after #120/#121.
- API spot-check: trust titles unchanged; lead-delivery still returns
  InboundContactIndex warning; portal-login succeeds for converted fixtures.
- `pnpm --filter @sa360/api test` / portal unit tests **not** required for a
  docs-only PR; none were weakened.

## Migrations

None.

## Risks

- Trust cards will look worse once live GHL is connected unless R1 ships first.
- R5 may be fixture-only. Confirm whether Approve & Release always commits
  allocations before treating it as a product bug.
- Place-order GHL labels only matter if controlled-beta customers create orders
  themselves.

## Follow-up dependencies

- Portal lane: R1 (own PR), R2, R3, R4.
- Product call on R5 (released package vs committed allocations).
- Auth/Account leftover `?access=` (prior F20) still not a Portal UX PR.
