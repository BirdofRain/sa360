# Customer portal controlled-beta gating — 2026-09-08

Validation only. No product code. No production writes. Rechecked the
**remaining 2026-09-08 checklist** on current `origin/master` after PRs
**#123** and **#124**.

Prior audits:

- `docs/validation/customer-portal-ux-bug-bash-2026-09-04.md` (after #117)
- `docs/validation/customer-portal-ux-bug-bash-2026-09-08.md` (after #120/#121)

## Scope and method

- **Master SHA:** `45f59e2d56cbd34fc0bf0589e63ad06a0f3f99e2` —
  `fix(portal): hide CRM SKUs and lead ingestion plumbing (#123)`
- **Also merged since the last bash:** #124
  (`fix(portal): make /portal/account a customer account page`).
- **How walked:** local API `:3001` + Next portal `:3000` after restarting
  Next onto this master. Same local `sa360` converted fixtures
  (`@example.test`). Desktop ~1440×900 and mobile 390×844.
- **Held out of the GO/NO-GO call:** released package with zero committed
  allocations (`LO-UXR-REL`). Recorded separately pending contract
  validation.

## Final call

**GO for controlled beta.**

#123 and #124 cleared the remaining launch-blocking Account / setup /
Place-order / Leads-list items. #120 and #121 did not regress. No P0. No
remaining P1 that blocks a paying agent from signing in, finishing account
setup, placing an order, reading payment/delivery, or opening leads.

---

## Remaining 2026-09-08 checklist

| Item | After #123/#124 | Call |
| --- | --- | --- |
| Account status C.O.C. dump | **Cleared.** No Account status section. No GHL Connection / webhook / signal / routing / snapshot / “Preview data…” cards. Ready account shows **Account setup complete** + **Place order**. | GO |
| Setup placeholders look filled | **Cleared.** Placeholders are **e.g. Veteran, Trucker** / **e.g. Final Expense, Aged**, italic, plus “Examples only — type your own.” Finish without typing still errors correctly. | GO |
| Place order GHL SKUs | **Cleared.** No CRM dropdown. No GHL Starter / GHL Pro copy. Fields: Lead type, Product, Quantity, Freshness, States, Notes. | GO |
| Leads All / Delivered presentation | **Cleared.** All title is **Leads** (“Leads on your account…”). No **LeadCapture Webhook**. Empty All: **No leads yet**. Delivered empty: **No delivered leads match this filter.** | GO |
| Tenant-safe navigation | **Still good.** Foreign order/lead → generic not-found, no other-tenant data. | GO |
| #120 / #121 regression | **No regression.** Payment still separate. Unpaid Delivery: **A download is not available yet.** Completed + no package: **No leads have been released yet.** Lead detail still has no InboundContactIndex / Funnel / Ad / Routing / LeadCapture. | GO |

## Separate: released package + zero committed allocations

**Out of the GO/NO-GO.** Still present on `LO-UXR-REL`: Delivery **Your
delivery is ready** + Download (5 leads) next to Lead delivery **0 of 5
delivered / Not started**. This fixture released a package without committed
allocations. Do not treat as a launch blocker until product confirms whether
production release can exist without those rows.

---

## What a paying agent now sees

- Email/password login; forgot-password and invite setup unchanged.
- Account is a customer profile (Business, signed-in email, lead focus,
  product types) plus setup complete / Place order — not C.O.C. diagnostics.
- Orders list has **Status** and **Payment** columns (desktop) / badges
  (mobile).
- Place order is lead-buyer language only.
- Leads All vs Delivered titles and empty copy match the filter. List no
  longer shows ingestion source plumbing.
- Contact masking remains intentional.

## Remaining non-blocking polish (not NO-GO)

- **Business** still shows greeting **Sam** instead of Hebda Insurance (prior
  F16, P2).
- Orders **Lead type** still stacks **Final expense** twice (niche + product,
  P2).
- Failed lead list row can still show **Received** under the Failed pill (P2).
- Login still says dashboard / Continue to dashboard (prior F14, P2).
- Invite unavailable still has no Back to sign in (prior F12, P2).

## Evidence

<video src="/opt/cursor/artifacts/portal_controlled_beta_gating_go.mp4" controls></video>

Desktop stills: Account without status cards; Orders Payment column; unpaid
Delivery copy; Place order without CRM; Leads All without LeadCapture;
setup placeholders prefixed with “e.g.”.

## Tests / builds

- No product tests added (audit-only).
- Manual desktop + mobile walk after Next restart onto `45f59e2`.
- Foreign order/lead 404 confirmed.
- None of the portal unit tests were skipped or weakened.

## Migrations

None.

## Risks

- Live GHL/trust APIs still exist; they are no longer rendered on Account.
- The held-out released-package/zero-allocation case can still confuse a
  customer if that path is real in production.
- Greeting-as-Business is visible but does not block ordering.

## Follow-up

- Product/contract: released package vs committed allocations (`LO-UXR-REL`).
- Portal polish PRs for F12/F14/F16 and duplicated Final expense if wanted
  after beta start.
