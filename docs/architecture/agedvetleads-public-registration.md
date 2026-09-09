# AgedVetLeads public account registration

Status: **Phase 2 implementation**  
Base: `origin/master` after Phase 1 public shell (#126)  
Lane: **Auth/Account** (contract, session, tenant create). Portal UX at `/get-started/register` and `/get-started/setup` is in this PR only to connect Get started → existing portal journey.

No Stripe. No automatic payment, approval, or fulfillment. No second user table, no second session cookie, no second order store.

---

## 1. Architecture / security decision

Reuse **`ClientAccount`** as the only customer record. Public register is a new write on that table, not a new identity system.

| Concern | Decision |
| --- | --- |
| Store | Existing `ClientAccount` row. No `User` / `Membership` table. |
| API | `POST /client/v1/portal-register` behind the existing portal API key (Next BFF only; browser never holds the key). |
| IDs | Server generates `clientAccountId` (`avl` + 20 hex). Browser `clientAccountId` is rejected (strict body). |
| Lifecycle | `status=onboarding`, `portalEnabled=true`. Completing setup uses existing `POST /client/v1/account/complete-onboarding` (may set `active`). Orders stay `submitted` until Alex confirms payment and approves. |
| Password | Same scrypt `hashPortalPassword` and length-only policy as invite-accept. |
| Session | Same `sa360_client_portal_session` cookie and `portalSessionEpoch` as login. Register does **not** invent a second cookie. |
| Invite | Operator invite-accept stays for Alex-provisioned tenants. Public register sets the password in the same atomic create (no extra token). Same hashing + epoch semantics. |
| Admin | Register cannot create admin sessions, GHL destinations, orders, allocations, or payment/approval writes. |

Rejected: invite-then-accept for public sign-up (extra hop, no session); a public Fastify route with no API key (anyone can hit the API origin); trusting `clientAccountId` from the form.

---

## 2. Records created (exact)

One `ClientAccount` insert, in a single Prisma `create` (atomic; no second statement):

| Field | Value |
| --- | --- |
| `clientAccountId` | Server `avl` + 20 hex (`^[a-z][a-z0-9_]*$`, ≤80) |
| `clientDisplayName` | Trimmed agency / business name |
| `status` | `onboarding` |
| `portalEnabled` | `true` |
| `portalDisplayName` | Same as display name |
| `portalLoginEmail` | Lowercased email (unique) |
| `portalPasswordHash` | scrypt encoded string |
| `portalPasswordSetAt` | `now` |
| `portalSessionEpoch` | `0` (session cookie embeds `0`) |
| `portalInviteTokenHash` / `ExpiresAt` | `null` |
| `primaryNicheKeys` | `["vet"]` (Aged Vet Leads default; customer can edit at setup) |
| `primaryProductTypes` | `[]` (required at setup before `readyToOrder`) |
| `notes` | `Public registration (Aged Vet Leads)` |

**Not created:** `ClientGhlDestination`, `LeadOrder`, allocations, export packages, admin users, payment rows.

---

## 3. Uniqueness / deduplication

- `portalLoginEmail` is already `@unique` (case-insensitive match at lookup; stored lowercase).
- Duplicate email → Prisma `P2002` → **generic** failure copy (no “email in use”). Same HTTP class as other create failures (400), not 409.
- `clientAccountId` collision → retry generate (cap 5); then generic failure.
- Sign-in remains the path for existing customers (`/portal/login`).

---

## 4. Session establishment

1. BFF validates origin/host, then `POST /client/v1/portal-register` with portal API key.
2. API hashes password, inserts row, returns public context (`clientAccountId`, names, email, `portalSessionEpoch`, `portalEnabled`, `status`). **Never** returns hash, invite token, or API keys.
3. BFF calls `portalSignedSessionCookieOptions` (same helper as login) and sets `sa360_client_portal_session`.
4. Redirect `/get-started/setup` (append allowlisted configurator query when present; see `agedvetleads-configurator-prefill.md`).
5. Setup uses existing profile PATCH + `complete-onboarding` with tenant from the **cookie**, not the form.
6. On complete (`readyToOrder` / `status=active`), redirect `/portal/orders/new` (same allowlisted query). Prefill is not an order.

Failed register: no cookie, no row.

---

## 5. Abuse protections

| Control | Behavior |
| --- | --- |
| Portal API key | Required on Fastify. Browser never sees it. |
| Origin / host allow-list | `Origin` / `Referer` / `X-Forwarded-Host` hostname must match `SA360_PUBLIC_REGISTER_ALLOWED_ORIGINS`, `SA360_PUBLIC_MARKETING_HOSTS`, `ADMIN_COC_BASE_URL`, `SA360_PORTAL_PUBLIC_BASE_URL`, or `CORS_ALLOWED_ORIGINS`. If **none** of those are set, only `localhost` / `127.0.0.1` / `::1` (deployable before DNS; **no** hardcoded production domain). |
| Rate limit | Redis: 5 / hour / email hash, 10 / hour / IP hash. 429 generic. |
| Validation | Email, name length, password 10–128. `.strict()` body — extra keys (ids, status, payment, roles) → 400. |
| Enumeration | Duplicate email uses the same copy as generic create failure. |
| Logging | Outcome + hashed email + hashed IP + generated id on success. Never password, never raw email. |
| Failure messages | Generic to the customer; password policy copy only when the password itself is invalid. |

---

## 6. Rollback / partial creation

- Hash **before** insert. If hashing throws, no row.
- Insert is one `create`. Unique / DB errors: no row.
- No invite token to orphan. No session cookie until the API returns `ok`.
- Setup/onboarding failures do not delete the account (customer can retry); they do not create orders.

---

## 7. Customer journey

**Before:** `/get-started` → “Need an account?” explained that Alex must provision + invite.

**After:** `/get-started` → Create account (`/get-started/register?…`) → `ClientAccount` onboarding + password + session → `/get-started/setup?…` → existing complete-onboarding → `/portal/orders/new?…` with the validated preview → submitted order → Alex payment/approval.

---

## 8. Schema / migration

**None.** Existing `ClientAccount` columns are sufficient. Do not add a registration table.

---

## 9. Follow-ups (not this PR)

- Email verification before first order (optional Auth/Account)
- C.O.C. queue of newly self-registered `onboarding` tenants (Quality)
- Configurator query-param prefill into `/portal/orders/new` (Portal; carried through register/setup in the prefill PR)
- Stripe (separate payment dimension)

---

## 10. Deployment

No Prisma migration. No new cookie name.

Production must have at least one origin allow-list source (`ADMIN_COC_BASE_URL` is usually enough; add `SA360_PUBLIC_MARKETING_HOSTS` or `SA360_PUBLIC_REGISTER_ALLOWED_ORIGINS` when the public hostname differs). Unset allow-list = localhost only.

Requires existing portal env: `CLIENT_PORTAL_API_KEY`, `CLIENT_PORTAL_SESSION_SECRET`, `NEXT_PUBLIC_SA360_API_BASE_URL`, local/prod Redis for rate limits.
