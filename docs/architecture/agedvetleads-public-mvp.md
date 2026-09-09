# AgedVetLeads.com public MVP — route, domain, and auth architecture

Status: **Phase 1 shell** (merged #126). Public self-registration is **Phase 2** — see `docs/architecture/agedvetleads-public-registration.md`.  
Audit base: `origin/master` @ controlled-beta GO (`60c3f14`, #125)  
Lane: **Portal** for the public UX. Auth/Account owns self-registration and any session-model change. Middleware only adds a public-path exemption + optional host rewrite — it does **not** redesign portal sessions, cookies, or tenants.

This is the hosting decision for the first public-facing Aged Vet Leads journey. It is optimized for **insurance agents buying Veteran leads**, and it must ship on the existing DigitalOcean admin-coc hostname **before** any public DNS is connected.

**Out of scope for Phase 1**

- Stripe / card capture / invoices
- Automatic fulfillment or automatic release
- A second Next.js app, second Fastify API, or duplicated `ClientAccount` / `LeadOrder` data
- Public self-registration that creates a tenant *(Phase 2)*
- Broad redesign of `/portal`
- Hard-coded production hostname (`agedvetleads.com` must not appear as a required deploy dependency)

---

## 1. Architecture decision

**Host the public Aged Vet Leads experience inside the existing Next.js `admin-coc` app as a third surface.**

Keep one Fastify API (`apps/api`) and one customer/order source of truth (`ClientAccount`, `LeadOrder`, portal session cookie `sa360_client_portal_session`). The public page is marketing + routing. After sign-in, the existing portal owns onboarding, order create, tracking, and released delivery.

| Surface | App | Path | Auth today |
| --- | --- | --- | --- |
| Public marketing | `apps/admin-coc` | `/get-started` | None |
| Customer portal | `apps/admin-coc` | `/portal/**` | Portal session (invite / per-customer password) |
| Admin C.O.C. | `apps/admin-coc` | `/` and dashboard routes | `ADMIN_COC_PASSWORD` cookie |
| API | `apps/api` | `/client/v1/*`, `/admin/v1/*` | Existing portal API key (BFF) / admin key |

Rejected alternatives:

| Alternative | Why not |
| --- | --- |
| Separate Next.js marketing site | Second deploy, split sessions, duplicate env, no shared portal cookie |
| Separate backend for “public orders” | Duplicates `LeadOrder`; Alex would not see the existing submitted-order queue |
| Replace `/` globally with marketing | Would hide Command Center on the current App Platform hostname |
| Hard-code `agedvetleads.com` | Not deployable before DNS; breaks preview URLs |

---

## 2. Domain / host strategy (no production hostname in code)

Phase 1 is **path-first**, with an **optional host rewrite**.

1. **Before DNS (required to work now)**  
   The landing is always at **`/get-started`** on whatever origin already serves admin-coc (local `:3000`, App Platform hostname, preview URL). No custom domain required.

2. **After DNS (env, not code)**  
   Point the public hostname at the **same** `sa360-admin-coc` web service. Set:

   ```text
   SA360_PUBLIC_MARKETING_HOSTS=example.com,www.example.com
   ```

   Middleware rewrites `/` → `/get-started` **and** 404s Admin C.O.C. chrome **only** when the request `Host` / `X-Forwarded-Host` matches that comma-separated list (lowercase, port stripped). The value is operator-configured. Code has **no** default public domain. Deploy this isolation **before** pointing public DNS.

3. **Admin operators** keep using the existing App Platform hostname. `/` on that host remains Command Center.

Do not invent a production URL in invite emails, metadata, or tests. Continue using `SA360_PORTAL_PUBLIC_BASE_URL` / `ADMIN_COC_BASE_URL` (already “unset → relative path”) for portal invite links.

---

## 3. Auth — what Phase 1 does and does not change

**Unchanged (Auth/Account contracts):**

- Portal login at `/portal/login`
- Invite accept at `/portal/invite/<token>`
- Forgot password at `/portal/forgot-password`
- Session cookie + `portalSessionEpoch` checks in the Node BFF / RSC loaders
- Admin C.O.C. password cookie
- No browser-held `CLIENT_PORTAL_API_KEY`

**Phase 1 middleware addition (smallest exemption, not an auth redesign):**

- `/get-started` and `/get-started/*` skip the admin password gate (otherwise the landing would redirect to `/login`)
- Matching `SA360_PUBLIC_MARKETING_HOSTS` rewrites `/` to that landing

Portal routes stay session-gated. Admin dashboard routes stay password-gated.

**Get started / Sign in routing:**

| CTA | Destination | Why |
| --- | --- | --- |
| Sign in | `/portal/login` | Existing customer contract |
| Get started / Create account | `/get-started/register` | Phase 2 public register (same `ClientAccount` + session cookie) |
| Preview → continue | `/portal/login?next=/portal/orders/new?…` | Existing customers; allowlisted prefill query (see `agedvetleads-configurator-prefill.md`) |
| Have an invite | `/portal/invite` | Existing token accept |

---

## 4. Desired customer journey vs what exists

| Step | Actor | Exists on master? | Phase 1 attach point |
| --- | --- | --- | --- |
| Public landing | Anonymous | **No** | `/get-started` (this PR) |
| Get started | Anonymous | **No** | Same page; no tenant create |
| Account creation | Agent (Phase 2) or Alex invite | `POST /client/v1/portal-register` or admin + invite | See `agedvetleads-public-registration.md` |
| Onboarding | Customer | `/portal/account` profile + setup | Unchanged |
| Configure Veteran request | Customer | `/portal/orders/new` (states, qty, freshness) | Public **preview only**; submit stays in portal |
| Review / submit | Customer | `POST /client/v1/lead-orders` → `submitted` | Unchanged |
| Confirmation | Customer | Portal order detail | Unchanged |
| Alex payment + approval | Alex | C.O.C. / Front Office confirm-payment + approve | Unchanged; still the gate |
| Track + released delivery | Customer | `/portal/orders/[id]`, leads, released CSV when present | Unchanged |

The public configurator is **not** commerce. It does not POST `/client/v1/lead-orders`. Copy states that this is a request, not a charge, and that Alex confirms payment outside this page.

---

## 5. Public self-registration — implemented in Phase 2

Phase 1 left this as an Auth/Account follow-up. Phase 2 implements `POST /client/v1/portal-register` with the existing `ClientAccount` row, scrypt password, and `sa360_client_portal_session` cookie. Details: `docs/architecture/agedvetleads-public-registration.md`.

**Operator invite path (still valid):**

1. Alex creates `ClientAccount` (`POST /admin/v1/clients`), default `status=onboarding`, `portalEnabled=false`
2. Alex enables portal + `portalLoginEmail`
3. Alex issues `POST /admin/v1/clients/:id/portal-invite`
4. Customer sets password at `/portal/invite/<token>`
5. Customer signs in; account setup on `/portal/account`; order create when ready

Public self-registration does not replace that operator path. It also does not auto-approve orders, confirm payment, or create a second user/order store.

---

## 6. Order-create contract (reuse, do not fork)

Existing client intake (`POST /client/v1/lead-orders` via the Next BFF):

- Body: `nicheKey`, `states` (canonical US codes), `leadVolume`, `campaignType`, optional `productType` / `notes`, plus hidden CRM/destination fields the portal already sanitizes
- Server forces `status=submitted`, `createdByRole=client`
- Customer cannot send status, prices, `orderKind`, payment fields, or `clientAccountId`
- Freshness UI maps onto existing `campaignType`: `Fresh leads` \| `Aged leads` (age-bucket copy is presentation; optional notes for 30–90 vs 90+)

Public preview uses the same vocabulary (states, quantity, freshness/age bucket, Veteran niche messaging) but **does not submit**. After sign-in, `/portal/orders/new` is the real form.

---

## 7. Phase 1 implementation map

| Area | Files (this PR) |
| --- | --- |
| Architecture | `docs/architecture/agedvetleads-public-mvp.md` |
| Public path + host helpers | `apps/admin-coc/src/lib/public-site/*` |
| Middleware exemption + rewrite | `apps/admin-coc/src/middleware.ts` |
| Landing | `apps/admin-coc/src/app/get-started/**`, `apps/admin-coc/src/components/public-site/**` |

No Prisma migration. No API route changes. No `/portal` redesign.

---

## 8. Next PR sequence

1. **Phase 1 — public MVP shell** (Portal, #126): landing, routing, host rewrite, docs
2. **Phase 2 — public registration** (#128): `POST /client/v1/portal-register`, `/get-started/register`, `/get-started/setup`
3. **Portal — configurator → order form prefill**: see `docs/architecture/agedvetleads-configurator-prefill.md` (allowlisted query + same-browser sessionStorage through login **and** register/setup)
4. **Quality / C.O.C. — inbound queue**: new registrations / access requests next to submitted orders
5. **Later — Stripe**: only after payment remains a separate dimension (`paymentConfirmationStatus`); do not collect cards on the public landing
6. **Later — DNS**: set `SA360_PUBLIC_MARKETING_HOSTS` when the public hostname is pointed at admin-coc

---

## 9. Risks

- Admin C.O.C. chrome is 404 on hosts in `SA360_PUBLIC_MARKETING_HOSTS` (`/login`, dashboard, Front Office, Agent Workspace). Operators keep using the App Platform hostname. Unset env = no isolation (required before DNS).
- Edge middleware still cannot enforce `portalSessionEpoch` (pre-existing). Public pages do not use that cookie.
- Honest “we open your account” copy is updated when self-registration ships (Phase 2).
- Public configurator age buckets are UX-only until the order form reads them (notes or a future catalog value). Do not add a new API enum in this PR.
- Middleware.ts is Auth/Account-owned. Isolation is host routing only; it does not change portal sessions, cookies, or tenants.
