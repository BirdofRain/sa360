# Customer portal UX bug bash — 2026-09-04

Audit only. No product code was changed. No production deploy. No production
writes. Walked the current customer portal on local `127.0.0.1` against
`origin/master` after PR **#117**.

## Scope and method

- **Master SHA:** `898334bf1fcd5717bfc10d601f70a0a316b40cf4` —
  `fix(portal): decouple login readiness from shared password (#117)`
- **Product reality used:** per-customer passwords, 3/3 converted, shared
  password retired, access code retired, self-service password recovery live.
  Retired migration behavior is **not** flagged as missing functionality.
- **Not in scope:** redesign, new CRM/AI/voice features, production credentials.
- **How walked:** local API on `:3001` + Next portal on `:3000`. Seeded
  converted customers in local `sa360` only (`@example.test` emails). Desktop
  (~1440×900) and mobile (iPhone 12 Pro, 390×844). Keyboard pass on login.
- **Known item left to Agent A:** 2–3 second route skeleton after
  **Finish account setup**. Not reproduced in this bash (complete → success
  was immediate locally). Still listed as a known P1, not a new finding.

## Verdict

**There is a launch blocker for controlled beta.**

A paying life-insurance agent can complete login and move through Overview /
Orders / Leads / Account, but three customer-facing surfaces currently look
broken or operator-only:

1. **Account status** is a C.O.C. diagnostic dump (GHL, webhooks, routing
   rules, signal health, client snapshot).
2. **Orders** show “spreadsheet being finalized” and fulfillment progress on
   unpaid / incomplete / completed-with-zero-delivered orders, and **never
   show payment state** on the order itself.
3. **Account setup** placeholders look like filled values, so Finish setup
   fails while the form still looks complete.

None of these are security/data-leak P0s (foreign resources 404 without
tenant leak). They **will** generate support tickets and make the beta look
unfinished.

---

## Top 5 fixes before controlled beta

1. **Replace Account status** with customer-safe copy, or hide it until there
   is a real customer-owned check. Do not show GHL / webhook / routing /
   signal / snapshot diagnostics, mock “Preview data — connect live sources
   for operational checks”, or “Needs attention” for 0 webhooks.
2. **Stop lying about delivery.** Hide “Your spreadsheet is being finalized”
   unless a package is actually being released. Show **payment** on the order
   list and order detail. Do not show Completed + “0 of 10 delivered” +
   “finalizing” together.
3. **Fix Account setup placeholders.** “Veteran, Trucker” / “Final Expense,
   Aged” look like real values. Empty required fields must look empty.
   After success, give a **Place order** control, not only a sentence.
4. **Strip operator warnings and jargon from lead detail.** Especially
   `No InboundContactIndex snapshot found for this lead scope.` Also hide or
   rewrite LeadCapture Webhook, Routing: Matched, Funnel, Ad.
5. **Customer-safe order summary.** Remove or rewrite GHL / CRM package /
   destination type / AI voice add-on / “GHL destination is not connected”
   for the paying agent. Keep lead type, quantity, states, freshness (aged vs
   fresh), and what happens next.

## Top 5 fixes safe to defer

1. Invite / invalid-token pages have no **Back to sign in** link (dead end).
2. Login copy: “Continue to dashboard” / “performance dashboard” vs the
   current journey home.
3. Sign out is tiny, low-contrast `text-xs text-slate-500`, easy to miss.
4. Leads **All** empty copy still says “No delivered leads yet”; section
   title is always “Delivered leads”.
5. Greeting name used as **Business**; Focus concatenates niche + product and
   can duplicate “Final expense”. Weak focus rings on nav / Sign out.

## Any launch blocker?

**Yes.** Do not put paying beta customers on Account status or the current
order Delivery/Fulfillment copy as-is. Auth, 404 isolation, empty-state CTAs,
and All/Delivered filter persistence are in good enough shape.

---

## What is already in good shape

- Email/password login (no access-code screen when modern login is configured).
- Generic forgot-password success (does not enumerate accounts).
- Invite password policy, confirm field, show-passwords.
- Foreign order/lead → “not found” without leaking the other tenant.
- Sign out returns to login; `/portal` after logout requires sign-in.
- Empty Orders has Place order (header + empty card).
- Empty first-order Overview hero is clear.
- Desktop orders table / mobile order cards.
- Contact masking is intentional buyer-safe behavior (not a bug).
- Nav Overview / Orders / Leads / Account with `aria-current`.
- Lead filter Back/Forward kept `?status=delivered` in this bash.

---

## Findings

Severity: **P0** blocks journey / security / data safety. **P1** likely support
ticket or meaningful confusion. **P2** polish/friction. **P3** cosmetic.

### F1 — Account status is C.O.C. diagnostics

| | |
| --- | --- |
| **Page** | `/portal/account` |
| **Repro** | Sign in as a converted customer. Open Account. Scroll **Account status**. |
| **Expected** | Customer-safe account health, or nothing until there is a check the agent owns. |
| **Actual** | Cards titled **GHL Connection**, **Delivery Readiness**, **Required Fields**, **Workflow / Pipeline Config**, **Webhook Health**, **Routing Rule Readiness**, **Signal Health**, **Client Snapshot Readiness**. Most summaries: “Preview data — connect live sources for operational checks” with **Preview**. Webhook Health / Signal Health: **Needs attention** (“0 received today” / “0 signal(s) sent in range”). |
| **Severity** | **P1 (launch blocker).** Not a data-leak P0, but it looks like the account is broken and uses operator language a life-insurance agent will not understand. |
| **Recommended change** | Do not present `GET /client/v1/trust` Front Office cards on the customer Account page. Either hide Account status, or map to 1–2 customer sentences (“Your account is ready to order” / “Your SA360 team is finishing delivery setup”). |
| **Likely files** | `apps/admin-coc/src/app/portal/account/page.tsx`, `portal-account-panel.tsx`, `apps/api/src/services/front-office/front-office-trust-present.service.ts` (client audience still forwards the same titles). |
| **PR** | **Own PR.** Highest-priority Portal-lane change. |

Customer-useful vs C.O.C.:

| Useful to a paying agent | Internal C.O.C. only |
| --- | --- |
| Business name, signed-in email | GHL Connection |
| Greeting name | Routing rule blockers / Routing Rule Readiness |
| Lead focus / product types they sell | Signal health |
| Ready to order / not ready, in plain language | Workflow / Pipeline Config |
| “Ask your SA360 team” when something is blocked | Webhook Health, Client Snapshot Readiness, Required Fields, Delivery Readiness, “Preview data…” |

### F2 — Delivery says spreadsheet is finalizing on unpaid and incomplete orders

| | |
| --- | --- |
| **Page** | Order detail, e.g. `/portal/orders/uxbash_20260904_ord_pay` |
| **Repro** | Open a **Submitted** order that has `requestedQuantity` set. |
| **Expected** | Delivery hidden or “We’ll prepare your spreadsheet after payment is confirmed.” |
| **Actual** | **Delivery:** “Your spreadsheet is being finalized.” **Fulfillment:** “0 of 50 delivered” / Not started. Status pill is only **Submitted**. No payment line. |
| **Severity** | **P1 (launch blocker)** |
| **Recommended change** | `portalOrderDeliverySectionState` currently treats `fulfillmentAvailable` (any configured quantity) as **finalizing**. Gate finalizing on active/completed **and** a real in-progress release, not on quantity existing. |
| **Likely files** | `portal-order-deliveries.ts`, `portal-order-delivery-section.tsx`, `portal-order-detail.tsx` |
| **PR** | Group with F3 and F4 (orders honesty). |

### F3 — Completed order still says 0 delivered and spreadsheet finalizing

| | |
| --- | --- |
| **Page** | `/portal/orders/uxbash_20260904_ord_done` |
| **Repro** | Open a **Completed** order with no committed allocations / no released export. |
| **Expected** | Completed means done: either delivered counts match, or copy says “No spreadsheet was released for this order. Contact your SA360 team.” |
| **Actual** | Header **Completed**. Fulfillment **0 of 10 delivered** / **Not started**. Delivery **Your spreadsheet is being finalized.** |
| **Severity** | **P1 (launch blocker)** |
| **Recommended change** | If status is `completed` and there are no released deliveries, say so. Never combine Completed + Not started + finalizing. |
| **Likely files** | `portal-order-detail.tsx`, `portal-order-fulfillment-section.tsx`, `portal-order-deliveries.ts` |
| **PR** | Group with F2/F4. |

### F4 — Payment state is missing from Orders list and order detail

| | |
| --- | --- |
| **Page** | `/portal/orders`, order detail |
| **Repro** | Create/open a submitted order with `paymentConfirmationStatus: pending_confirmation`. Compare with Overview. |
| **Expected** | List + detail show **Awaiting payment confirmation** (or Payment confirmed / No payment due). Customer knows whether to pay. |
| **Actual** | List status is **Submitted**. Detail has no Payment row. Overview can hide payment behind a higher-priority order (this bash: hero was **Needs setup**, so the unpaid order was invisible as a next action). |
| **Severity** | **P1** |
| **Recommended change** | Show payment on list (second line or pill) and as a Fact on detail. If payment is pending, Overview should not bury it behind an operator “needs setup” order without a second CTA. |
| **Likely files** | `portal-orders-list.tsx`, `portal-order-detail.tsx`, `portal-journey.ts` |
| **PR** | Group with F2/F3. |

### F5 — Age bucket is not a customer-facing field

| | |
| --- | --- |
| **Page** | `/portal/orders/new`, order list, order detail |
| **Repro** | Place order. Inspect Freshness / Order type. |
| **Expected** | If commerce age buckets (1–3 mo, 3–6 mo, …) are how inventory is sold, the customer can choose and later see that bucket. |
| **Actual** | Form **Freshness**: Fresh leads / Aged leads / Live transfer. List shows that under the order number. Detail **Order type**. Notes on the unpaid fixture said “3-6 month aged if possible” because there is no age-bucket control. |
| **Severity** | **P1** if beta actually sells aged inventory by bucket; **P2** if operators always pick the bucket after a generic “Aged leads” request. |
| **Recommended change** | Either add a single customer-safe age-bucket select for Aged leads, or copy that SA360 will confirm the age range after review. Do not invent CRM/AI features. |
| **Likely files** | `portal-order-request.ts`, `portal-order-request-form.tsx` |
| **PR** | Own small PR if product confirms buckets are customer-chosen; otherwise copy-only in the orders honesty PR. |

### F6 — Order summary exposes GHL / CRM SKUs / destination type

| | |
| --- | --- |
| **Page** | Order detail, `/portal/orders/new` |
| **Repro** | Open LO-UX-PAY / LO-UX-ACT / Place order. |
| **Actual** | **CRM package:** “GHL starter + sa360 ai”, “GHL pro + sa360 routing”. **Destination:** “Hebda Insurance GHL”. **Destination type:** “GHL location”. **AI voice add-on:** Included. Place order **CRM** dropdown defaults to **GHL Starter**. Needs-setup warning: **“GHL destination is not connected for this order.”** |
| **Expected** | Delivery destination as a location/business name. Package in agent language, or omit. Connection failures: “Your lead destination isn’t connected yet. Your SA360 team is on it.” |
| **Severity** | **P1** |
| **Recommended change** | Presentation-only labels. Do not send GHL SKUs in the customer catalog if the agent cannot act on them. |
| **Likely files** | `portal-order-detail.tsx`, `portal-order-request.ts` (`PORTAL_ORDER_REQUEST_CRM_PACKAGES`), `portal-labels.ts`, `lead-order-present.service.ts` `setupWarnings` |
| **PR** | Own PR or group with F2–F4. |

### F7 — Account setup placeholders look filled; Finish then errors

| | |
| --- | --- |
| **Page** | `/portal/account` (onboarding) |
| **Repro** | Sign in as incomplete account. Lead focus / Product types show gray **Veteran, Trucker** and **Final Expense, Aged**. Click **Finish account setup** without typing. |
| **Expected** | Empty required fields look empty. Placeholder is clearly example-only, or use chips/selects. |
| **Actual** | Placeholders read as values. Finish returns “Add at least one lead focus.” / “Add at least one product type.” and “Add the required account details before finishing setup.” while the boxes still look filled. |
| **Severity** | **P1** |
| **Recommended change** | Drop example placeholders, or prefix “Example:”. Prefer a constrained picker over comma-separated free text. Clear stale `missingFields` when the user types. After success, add **Place order** (Overview already does; Account does not). |
| **Likely files** | `portal-account-onboarding.tsx` |
| **PR** | Own PR (Account setup UX). |

### F8 — Account setup complete has no next-action control

| | |
| --- | --- |
| **Page** | `/portal/account` after Finish |
| **Repro** | Complete setup. Stay on Account. |
| **Expected** | “You’re ready to place an order.” plus a Place order button. |
| **Actual** | Green banner only. Operator Account status cards still sit underneath. |
| **Severity** | **P2** (Overview hero does switch to Place order.) |
| **Recommended change** | Link the success banner to `/portal/orders/new`. Hide F1 cards. |
| **Likely files** | `portal-account-onboarding.tsx`, `portal/account/page.tsx` |
| **PR** | Group with F7. |

### F9 — Known: skeleton after Finish account setup

| | |
| --- | --- |
| **Page** | Account → Overview after complete |
| **Repro** | Task-known: Finish account setup, then `router.refresh()`. |
| **Expected** | Keep chrome; swap the form for the success state. |
| **Actual** | This bash: success was immediate; no 2–3s blank. Code still uses `onSuccess → router.refresh()` and nested `loading.tsx` is a **full-page** `PortalPageSkeleton` (nav is fake pulse bars, not the real chrome). |
| **Severity** | **P1 known.** Agent A owns the fix. Do not duplicate. |
| **Likely files** | `portal-account-onboarding-live.tsx`, `app/portal/account/loading.tsx`, `portal-page-skeleton.tsx` |
| **PR** | Agent A’s PR. |

### F10 — Lead detail shows an internal diagnostic warning

| | |
| --- | --- |
| **Page** | `/portal/leads/:id` (delivered lead Robert Hayes) |
| **Repro** | Open a delivered lead. |
| **Actual** | Orange: **“No InboundContactIndex snapshot found for this lead scope.”** Also **Source: LeadCapture Webhook**, **Funnel**, **Ad**, **Routing: Matched**. |
| **Expected** | Customer sees name (masked contact if that is the beta contract), campaign in plain language, delivered date/status. Internal pipeline errors stay in C.O.C. |
| **Severity** | **P1** (not P0: no tenant leak, does not block download/login). Still unacceptable in beta. |
| **Recommended change** | Filter `warnings` / `errorSummary` for customer audience. Drop or rewrite Funnel / Routing / webhook source labels. |
| **Likely files** | `portal-lead-detail.tsx`, `map-client-leads.ts`, `lead-delivery-present.service.ts` |
| **PR** | Own PR (leads customer-safe present). |

### F11 — Leads All vs Delivered copy and list title

| | |
| --- | --- |
| **Page** | `/portal/leads`, `/portal/leads?status=delivered` |
| **Repro** | Empty account: toggle All vs Delivered. Ready account: All shows Pending / Failed / Delivered. |
| **Actual** | Section title always **Delivered leads**. All empty: “No delivered leads yet” / “Leads routed to your account will appear here after delivery is recorded.” Delivered empty: “No delivered leads match this filter.” List status subtext can contradict the pill (**Failed** + **Received**; **Pending** + **Delivery started**; **Delivered** + **Delivered**). |
| **Expected** | All = every lead you can see. Title not “Delivered leads” on All. Empty All should not say “routed”. Failed should not also say Received as the latest activity in a way that looks like success. |
| **Severity** | **P1** for All empty + title; **P2** for redundant last-event under Delivered. |
| **Recommended change** | Title “Leads”. All empty: “No leads yet. They appear here after we send them to you.” Don’t show last-event when it duplicates the pill. |
| **Likely files** | `portal-leads-list.tsx`, `portal-lead-list-status.ts` |
| **PR** | Group with F10. |

### F12 — Invite unavailable is a dead end

| | |
| --- | --- |
| **Page** | `/portal/invite`, `/portal/invite/not-a-valid-token` |
| **Repro** | Open those URLs signed out. |
| **Expected** | Same invalid copy **plus** Back to sign in / Forgot password links. Tab title matches the error. |
| **Actual** | Copy tells the user to use sign-in, but there is **no link**. Tab title remains **Choose a new password**. |
| **Severity** | **P2** |
| **Recommended change** | Add the same back link as forgot-password. Set metadata title for the invalid state. |
| **Likely files** | `app/portal/invite/page.tsx`, `invite/[token]/page.tsx`, `invite/layout.tsx` |
| **PR** | Group with copy/a11y polish. |

### F13 — Forgot password leftover intro after success

| | |
| --- | --- |
| **Page** | `/portal/forgot-password` |
| **Repro** | Submit any email. |
| **Actual** | Intro still says “Enter the email…”. Form is gone. Generic success box remains. Field label **Portal login email** is jargon. |
| **Expected** | Replace the intro with the success message only. Label **Email**. |
| **Severity** | **P2** (generic success itself is correct). |
| **Likely files** | `forgot-password/page.tsx`, `portal-forgot-password-form.tsx`, `portal-password-reset-flow.ts` |
| **PR** | Group with F12. |

### F14 — Login copy still talks about a dashboard

| | |
| --- | --- |
| **Page** | `/portal/login` |
| **Repro** | Open `/portal/login` signed out. Read heading, submit button, and document description. |
| **Expected** | Sign in to your portal. Button **Sign in**. Description matches Overview, not a metrics dashboard. |
| **Actual** | Heading **Sign in to your dashboard**. Button **Continue to dashboard**. Layout metadata description “performance dashboard”. Home is a journey (“What you need to do”), not a metrics dashboard. |
| **Severity** | **P2** |
| **Recommended change** | Replace dashboard wording with portal / sign in. |
| **Likely files** | `portal-login-flow.ts`, `portal-login-form.tsx`, `login/layout.tsx` |
| **PR** | Group with F12/F13. |

### F15 — Sign out discoverability and contrast

| | |
| --- | --- |
| **Page** | Authenticated chrome |
| **Repro** | Sign in. Look at the top-right of Overview / Orders / Leads / Account on desktop and 390px. |
| **Expected** | Same visual weight as a secondary nav action; 44px hit target. |
| **Actual** | Top-right **Sign out**, `text-xs font-medium text-slate-500`, no `min-h-11`. Works, but easy to miss; gray-on-white is weak. |
| **Severity** | **P2** |
| **Recommended change** | Use the same secondary-button treatment as other chrome actions; keep it in the header on mobile. |
| **Likely files** | `portal-app-frame.tsx` |
| **PR** | Group with a11y polish. |

### F16 — Greeting name shown as Business; Focus duplicates products

| | |
| --- | --- |
| **Page** | Account panel, header, order identity |
| **Repro** | Ready customer: `portalDisplayName` = Sam, `clientDisplayName` = Hebda Insurance. Open Account and any order. |
| **Expected** | Business = account name. Greeting is how we say hello. Focus does not repeat the same token from niche + product. |
| **Actual** | Header and orders: **Sam — LO-UX-***. Account **Business: Sam**. **Focus:** Veteran · Final expense · Final expense · Mortgage protection. |
| **Severity** | **P2** |
| **Recommended change** | Prefer `clientDisplayName` for Business. Deduplicate Focus tokens. Keep greeting in the hello line only. |
| **Likely files** | `portal/account/page.tsx` (`portalDisplayName \|\| clientDisplayName`), `portal-account-panel.tsx`, `portal-order-identity.tsx` |
| **PR** | Group with F7 or a11y/copy. |

### F17 — Overview hero vs “who acts” on needs-setup

| | |
| --- | --- |
| **Page** | `/portal` |
| **Repro** | Sign in as a converted customer with both a needs-setup order and a payment-pending order. |
| **Expected** | Hero says who acts. If SA360 owns setup, the title should not sound like the customer must finish it. Payment-pending should still be visible. |
| **Actual** | Title **Your order needs a bit more setup**. Detail **Your SA360 team is finishing the details**. No customer CTA (correct if the agent cannot fix it) but the title sounds like the customer must do something. Unpaid order is not the hero. |
| **Severity** | **P2** |
| **Recommended change** | If the next step is internal: “We’re finishing setup on LO-…”. Keep payment-pending as a first-class hero when payment is actually pending. |
| **Likely files** | `portal-journey.ts` |
| **PR** | Group with F4. |

### F18 — Keyboard / focus / a11y

| | |
| --- | --- |
| **Page** | Login, nav, forms |
| **Repro** | Tab through `/portal/login`; inspect Sign out / Portal nav. |
| **Actual** | Login fields are labeled; invalid credentials use `role="alert"`. Forgot-password link shows a clear outline. Email/password/button focus rings are easy to miss (`ring-ring/50`). Portal nav links have **no** `focus-visible:ring`. Sign out neither. Account form labels, required/optional, and `role="alert"` are good. Status pills are not announced as live status. Skeleton has `role="status"` + sr-only (good) but replaces the whole chrome. |
| **Severity** | **P2** |
| **Recommended change** | Add the same `focus-visible:ring-2` used on journey CTAs to nav + Sign out. Stronger input rings. `aria-busy` on pending login/invite/forgot buttons. |
| **Likely files** | `portal-nav.tsx`, `portal-app-frame.tsx`, `portal-login-form.tsx`, `components/ui/input.tsx` |
| **PR** | Group with F15. |

### F19 — Loading: full-page skeleton can hide known chrome

| | |
| --- | --- |
| **Page** | Any `/portal/*` with `loading.tsx` |
| **Repro** | Slow navigation / `router.refresh()`. Rapid tab switching in this bash often **kept** chrome (fast compile). |
| **Actual** | `PortalPageSkeleton` is a full `min-h-dvh` pulse header+cards, not the real nav. Login loading is a blank pulsing card. |
| **Expected** | Keep real header/nav; pulse only the content well. |
| **Severity** | **P2** (P1 when it lasts 2–3s after account complete — F9) |
| **Likely files** | `portal-page-skeleton.tsx`, `app/portal/**/loading.tsx` |
| **PR** | Agent A if overlapping; else small Portal PR. |

### F20 — Residual access-code path (not missing functionality)

Access code is **retired** for day-to-day beta. This bash did **not** set
`CLIENT_PORTAL_ACCESS_CODE`. Login was email/password.

Leftover code still exists: `PortalAccessGate`, `/portal?access=`, middleware
bypass. Do **not** treat that as a missing feature. If production env still
has an access code, `?access=` can still mint a session — that is Auth-lane
hardening, not a UX gap for converted customers.

| **Severity** | **P2 residual risk** (Auth/Account lane), only if env leftover. |
| **PR** | Do not mix into a Portal UX PR. |

### F21 — Comma-separated lead focus / product types

Covered with F7. Additional product note: agents think in niches they buy
(Veteran, Final Expense), not free-text tokens. Placeholder **Aged** as a
product type is especially confusing next to order **Freshness: Aged leads**.

**Severity:** **P2** (P1 when combined with F7 placeholders).  
**PR:** Group with F7.

### F22 — Mobile

| | |
| --- | --- |
| **Page** | Login, Overview, Orders, Leads, Account at 390×844 |
| **Actual** | Login card stacks. Orders use cards (not the desktop table). Nav four items fit without wrapping in this viewport. Place order is full width. Sign out is small but tappable. No horizontal page scroll observed on list pages. Autocomplete on mobile login can cover **Continue to dashboard**. |
| **Severity** | **P3** for autocomplete covering the button; otherwise mobile list layout is acceptable. Order detail GHL/jargon issues (F2–F6) still apply. |
| **PR** | No dedicated mobile PR unless a later pass finds overflow on order detail Dates/Activity. |

### F23 — Error copy (save vs not saved)

| Surface | What happened | Saved? | Next step |
| --- | --- | --- | --- |
| Login invalid | Clear | N/A | Try again / forgot password |
| Account Finish validation | Clear that setup did not finish | No | Fill fields |
| Account save generic | “We couldn’t save your account. Try again.” | Implies no | Retry / SA360 team |
| Order/lead fetch fail | “could not be loaded” + try again / SA360 team | N/A | OK |
| Delivery load error | “Delivery status could not be loaded.” | Unclear if a download was affected | **P2:** say the list failed, retry, team |
| Invite accept failure | Generic invalid | Password not saved | Dead end (F12) |

No P0 here. Tighten Delivery load error in the orders honesty PR.

---

## Accessibility checklist (this bash)

| Check | Result |
| --- | --- |
| Keyboard login | Email autoFocus; Tab reaches password, forgot-password, submit. Forgot-password outline visible. Inputs/button rings weak. |
| Focus states | Journey CTAs have rings. Nav + Sign out do not. |
| Form labels | Login, forgot, invite, account, place-order labels present. |
| Disabled/loading | Buttons disable and change label (Signing in…, Sending…, Finishing setup…). No `aria-busy`. |
| Contrast | Body text OK. Sign out / footer / helper `slate-400/500` is the weak set. |
| Status/error announcements | Login/account errors `role="alert"`. Success `role="status"` on forgot and account save. Status pills are visual only. Skeleton `role="status"`. |

---

## Copy glossary (do not show to agents as-is)

GHL, GHL location, GHL destination, CRM package, destination type, AI voice
add-on, fulfillment, routing, routing rule, webhook, webhook pipeline, signal
health, client snapshot, workflow/pipeline config, LeadCapture Webhook,
InboundContactIndex, Funnel, Ad (as a system field), portal login email,
Continue to dashboard, Preview data — connect live sources for operational
checks, Leads committed to this order, Leads routed to your account.

Keep: order number, lead type, quantity, states, fresh vs aged vs live
transfer, payment confirmation, download spreadsheet, sign in, sign out.

---

## Evidence

Local walkthrough screenshots (not production):

<video src="/opt/cursor/artifacts/portal_launch_risk_screens.mp4" controls></video>

Key stills: login, forgot password, invite unavailable, Overview, Orders
list, unpaid order, completed contradiction, needs-setup GHL warning, place
order GHL, leads list, lead InboundContactIndex warning, Account operator
cards, setup placeholders/validation/complete, empty orders/leads, mobile
overview and order cards.

## Tests / builds

- No product tests added (audit-only).
- Manual desktop + mobile walkthrough against local API + portal.
- Foreign order/lead 404 confirmed in UI.
- `pnpm --filter @sa360/api test` / portal unit tests **not** required for a
  docs-only PR; none were weakened.

## Migrations

None.

## Risks

- Seeded local customers live only in Cloud Agent `sa360` on 127.0.0.1.
- Fulfillment “0 delivered” on completed orders can also happen in real data
  if allocations were never committed — the UI still must not contradict
  **Completed**.
- Trust cards will look even worse once live GHL is connected (real blockers
  instead of Preview), unless F1 ships first.

## Follow-up dependencies

- Agent A: account-complete skeleton (F9).
- Auth/Account: leftover `?access=` hardening (F20), not a Portal UX PR.
- Product call on F5: are commerce age buckets customer-chosen in beta?
