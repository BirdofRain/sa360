# AgedVetLeads public buyer journey gate — 2026-09-09

Validation only. No product code. No production writes. Rechecked the
complete public buyer journey on fresh `origin/master` after PRs **#127**
and **#128**.

Contracts:

- `docs/architecture/agedvetleads-public-mvp.md` (#126 shell)
- `docs/architecture/agedvetleads-public-registration.md` (#128)
- `docs/architecture/agedvetleads-configurator-prefill.md` (#127)

## Scope and method

- **Master SHA:** `127b66eb7c200c8bf4fd880cf432fe0c5c17e7fe` —
  `AgedVetLeads configurator to order-form prefill (#127)`
- **Also merged:** #128
  (`feat: public AgedVetLeads account registration into existing portal`)
- **How walked:** local API `:3001` + Next admin-coc `:3000` against local
  `127.0.0.1` Postgres/Redis. Fresh `@example.test` tenants. Desktop and
  **390×844** (iPhone 12 Pro emulation).
- **Not used:** production credentials, live GHL, Stripe, DNS.

## Final call

**GO for public MVP** on this master, once the deployment environment
requirements below are set on the App Platform services. No P0. No
remaining P1 that blocks a new agent from configuring on `/get-started`,
creating an account, finishing setup, reviewing, submitting, or seeing
that submitted request in Admin C.O.C. Front Office and in the portal.

Submission does **not** confirm payment, approve, allocate, reserve, or
fulfill.

---

## Exact values carried through (Customer A)

| Step | Exact value |
| --- | --- |
| Public configure | states `TX,FL`; qty `250`; freshness `aged-30-90`; niche `vet` |
| Register query | `/get-started/register?states=TX%2CFL&qty=250&freshness=aged-30-90&niche=vet` |
| Setup query | same allowlisted query on `/get-started/setup` |
| Agency | `Gate Valley Vet Agency` |
| Email | `avl-gate-a-20260909@example.test` |
| Greeting | `Gate Valley` |
| Lead focus / product | `vet` / `Final Expense` |
| `clientAccountId` | `avle509dd3ef3c005b45349` (server `avl` + 20 hex) |
| Account after setup | `status=active`, `portalEnabled=true`, notes `Public registration (Aged Vet Leads)` |
| Order form URL | `/portal/orders/new?states=TX%2CFL&qty=250&freshness=aged-30-90&niche=vet` |
| Mapped create body | `nicheKey=vet`, `states=["TX","FL"]`, `leadVolume=250`, `campaignType=Aged leads`, `productType=Final Expense`, `notes=Requested age bucket: 30–90 days` |
| Order | `LO-1043` / `cmtu68m830000jswmp5bt7x1y` |
| Stored CRM stamp | `crmPackage=lead_delivery` |
| Destination stored | `Gate Valley Vet Agency` (customer UI: account target, no GHL SKU) |
| `createdByRole` | `client` |
| Status | `submitted` (`submittedAt=2026-09-09T14:06:02.879Z`) |
| Payment | `pending_confirmation`; `paymentConfirmedAt=null`; `paymentConfirmedBy=null` |
| Approval / activation | `approvedAt=null`; `activatedAt=null` |
| Fulfillment counters | `orderKind=null`, `fulfillmentMode=null`, `requestedQuantity=null`, `proposedQuantity=0`, `reservedQuantity=0`, `fulfilledQuantity=0` |
| Allocations / lines / packages | `0` / `0` / `0` |

Customer B (isolation): `Isolation Mutual Agency` /
`avl-gate-b-20260909@example.test` /
`clientAccountId=avl7bb69a95ccf6046f4173` / `Term Life`. Empty order list.
`GET /client/v1/lead-orders/cmtu68m830000jswmp5bt7x1y?clientAccountId=avl7bb69a95ccf6046f4173`
→ **404** `{ ok:false, error:"Lead order not found" }` with no A payload.

Existing-customer continue (A, second configure, **not submitted**):
`states=OH,PA`, `qty=50`, `freshness=fresh`, `niche=vet` →
`/portal/login?next=/portal/orders/new?states=OH%2CPA&qty=50&freshness=fresh&niche=vet`
→ form Veteran / 50 / Fresh leads / OH+PA. No second `LeadOrder` row.

---

## Checklist

| Item | Result | Call |
| --- | --- | --- |
| `/get-started` configure | TX+FL, 250, Aged · 30–90 days. Copy: request preview, not a charge. No card form. No `agedvetleads.com` hard requirement. | GO |
| Create account | Create account CTA keeps allowlisted query. No `crmPackage` / SKU in URL. | GO |
| Registration | `POST /client/v1/portal-register` → onboarding `ClientAccount` + `sa360_client_portal_session`. No order row at this step. | GO |
| Setup | Finish setup and continue → `status=active`, same query on `/portal/orders/new`. | GO |
| Prefill | Notice + Veteran, 250, TX/FL, Aged leads, notes `Requested age bucket: 30–90 days`. Review is a separate step. | GO |
| Explicit submit | Review request → Submit order request. Not auto-submitted. | GO |
| Admin C.O.C. | Front Office `/front-office/orders?role=admin` shows **LO-1043**, Gate Valley Vet Agency, **Submitted / Payment pending**. Operator CRM field is `lead_delivery`. Confirm Payment & Approve remain manual. | GO |
| Portal visibility | Orders list + detail: Submitted, Payment pending, Veteran, 250, TX/FL, 30–90 notes. Delivery not available. No linked leads. | GO |
| Existing-customer sign-in | Configure → Sign in to submit this request → login `next` preserves query → prefilled form, no auto-submit. | GO |
| Tampered prefill | `ZZ` dropped (TX kept); `qty=abc` dropped (quantity defaulted to 100); `freshness=live-transfer` and `niche=trucker` dropped; `crmPackage=GHL Pro` / `sku=GHL Starter` / `status=ready` / `clientAccountId` / payment keys **not applied**. No CRM dropdown. Still requires Review request. | GO |
| Tenant isolation | B cannot read A’s order (generic not-found). B list empty. API 404 for B’s tenant id. | GO |
| Desktop | Full new-customer path recorded. | GO |
| 390px | Landing/register/login, `/portal/orders/new`, orders list, order detail stack; no horizontal overflow; LO-1043 visible. | GO |
| No auto payment / approve / allocate / reserve / fulfill | DB + UI + FO actions still pending. | GO |
| CRM stamp | Server-owned `lead_delivery`. Customer UI has no GHL Starter / GHL Pro / SKU picker. Customer cannot supply a GHL SKU through prefill or the create form. | GO |

---

## Deployment environment requirements

No Prisma migration. No new cookie name.

**API (`sa360-api`) and admin-coc must share:**

| Variable | Required | Notes |
| --- | --- | --- |
| `CLIENT_PORTAL_API_KEY` | Yes | Browser never holds it. BFF header `x-sa360-client-portal-key`. |
| `CLIENT_PORTAL_SESSION_SECRET` | Yes | HMAC for `sa360_client_portal_session`. |
| `NEXT_PUBLIC_SA360_API_BASE_URL` | Yes (admin-coc) | Public API origin, no trailing slash. |
| Redis (`REDIS_URL`) | Yes | Public register rate limit (5/email/hr, 10/IP/hr). Fails closed if Redis is down. |
| `ADMIN_API_KEY` / `SA360_ADMIN_API_KEY` | Yes for live FO queue | Front Office live bridge. Unset → mock/fallback, new public orders would not appear. |

**Origin allow-list (register):** combine `SA360_PUBLIC_REGISTER_ALLOWED_ORIGINS`,
`SA360_PUBLIC_MARKETING_HOSTS`, `ADMIN_COC_BASE_URL`,
`SA360_PORTAL_PUBLIC_BASE_URL`, `CORS_ALLOWED_ORIGINS`. If **none** are
set, only `localhost` / `127.0.0.1` / `::1` are allowed — **production
will 403 register** until at least one is set (usually `ADMIN_COC_BASE_URL`).
Do not hard-code `agedvetleads.com` in app code. When DNS is ready, add
the public hostname to `SA360_PUBLIC_MARKETING_HOSTS` (optional `/` →
`/get-started` rewrite) and/or `SA360_PUBLIC_REGISTER_ALLOWED_ORIGINS`.

**Do not set** `CLIENT_PORTAL_CLIENT_ACCOUNT_ID` on the public-MVP API.
That env pins a single tenant and would break self-registration isolation.
Tenant comes from the session cookie.

**Leave unset for this MVP:** Stripe keys, live GHL tokens, public DNS
(until the host list is configured).

Local this run: allow-list empty (loopback only);
`CLIENT_PORTAL_CLIENT_ACCOUNT_ID` unset; `ADMIN_COC_PASSWORD` unset
(dashboard gate off; FO used `?role=admin` in development).

---

## Blockers

**None for the buyer journey on this master.**

Non-blocking (do not flip to NO-GO):

- Front Office **admin create** form still offers operator GHL package
  labels (`GHL Starter + SA360 AI`). That is the existing operator path,
  not the customer create path. The submitted public order drawer showed
  `lead_delivery`.
- Front Office at 390px: operator chrome + hamburger work; the admin
  create form is long, so the review queue sits below the fold.
- Public setup header can still show Sign in while a session exists
  (#128 cosmetic).
- Prefill is lost if register/login happens in another browser (no
  unauthenticated server draft — by contract).
- Operators may see `lead_delivery` on new portal orders vs historical
  `GHL Starter`. Do not rewrite history.

---

## Tests / builds

| Check | Result |
| --- | --- |
| Focused admin-coc journey tests (47) | pass |
| Focused API register / origin / lifecycle tests (27) | pass |
| `pnpm --filter @sa360/admin-coc test` | **1101 pass, 0 fail** |
| Manual desktop new-customer journey | pass (`LO-1043`) |
| Manual existing-customer, tamper, isolation | pass |
| Manual 390×844 | pass (customer surfaces) |
| Migrations | none |

No product tests were skipped or weakened. No product files changed.

---

## Risks

- Promoting without an origin allow-list source makes public register
  localhost-only.
- Promoting with `CLIENT_PORTAL_CLIENT_ACCOUNT_ID` set would pin tenants.
- FO live queue needs the admin API key on admin-coc or Alex will not see
  new submitted orders in the UI (API rows would still exist).
- Customer JSON from `GET /client/v1/lead-orders/:id` still includes
  `crmPackage: "lead_delivery"`. Portal pages do not render a GHL SKU;
  do not add a customer CRM picker later without a separate contract.

## Follow-up (not this gate)

- Optional email verification before first order.
- C.O.C. queue of newly self-registered `onboarding` tenants.
- Stripe, only as a separate `paymentConfirmationStatus` writer.
- DNS: set `SA360_PUBLIC_MARKETING_HOSTS` when the public hostname points
  at admin-coc.
