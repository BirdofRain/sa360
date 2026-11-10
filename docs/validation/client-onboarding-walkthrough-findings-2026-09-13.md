# Client onboarding walkthrough findings — 2026-09-13

Validation + documentation only. No product changes. No production writes (no invites issued, no orders submitted, no releases, no password changes, no forgot-password sends on the deployed app).

## Evidence

| Source | What was observed |
| --- | --- |
| Deployed API | `https://sa360-sw6oq.ondigitalocean.app/health` → `commitShort=ee4963f` (same as `origin/master` / #139) |
| Deployed admin-coc / portal | `https://sa360-api-staging-coo57.ondigitalocean.app` — public `/get-started`, `/login`, `/portal/invite`, `/portal/forgot-password`; signed-in **Smart Agent 360 Demo** portal (existing demo session; read-only) |
| Local replica | Docker Postgres/Redis on `127.0.0.1`, same commit, localhost-only API keys. Used for create-client, invite, register, password set, Front Office / Fulfillment Ops screens. |
| Video | `docs/validation/artifacts/client-onboarding-2026-09-13/sa360-client-onboarding-walkthrough.webm` (local write-path recording with on-screen chapter banners) |

**Production safety stop:** the workspace `.env` `DATABASE_URL` points at DigitalOcean Postgres. It was **not** used for writes. Local migrate/API used `127.0.0.1:5432` only. Deployed walkthrough did not download lead CSVs, did not click Place order submit, did not generate invites, did not sign in to Admin C.O.C.

## Current flow (actual)

**INTERNAL (operator-provisioned)**  
Create client on `/clients` (status `onboarding`, portal off) → enable portal + save login email → generate invite and **copy the link** (no email, 48h TTL, reissue invalidates prior) → customer sets password → customer signs in → customer finishes profile **or** operator sets `active` → Front Office confirm payment + approve → Fulfillment Ops activate / export / **Approve & Release**.

**CUSTOMER — public Aged Vet**  
`/get-started` preview (no charge) → `/get-started/register` (password + session) → `/get-started/setup` → `status=active` → `/portal/orders/new` → submitted / payment pending → wait for internal confirm + approve → leads only after release.

**CUSTOMER — invite**  
Receive pasted link → `/portal/invite/{token}` → `/portal/login?passwordSet=1` → `/portal` “Complete your account” → `/portal/account` → ready to order.

**Not implemented:** invite email, Stripe, in-session password change, customer-editable login email, auto-approve, auto-fulfill, auto-release.

## Friction log

### P0 — prevents onboarding

None observed that fully blocks a determined operator with admin access and a copy/paste channel to the customer. Public register and invite-accept both created usable local sessions in the recording.

### P1 — confusing enough to cause support tickets

1. **perspective:** both · **page/route:** `/portal/orders` (deployed demo)  
   **issue:** Completed/released demo orders still show **Payment pending**.  
   **expected:** Payment column should match Front Office confirmation, or hide pending once the order is completed/released.  
   **observed:** LO-1048 and LO-1049: Status **Completed**, Payment **Payment pending**, Delivered 1 of 1. Overview simultaneously said **Your order is ready** / Download spreadsheet.  
   **severity:** P1  
   **recommended future fix:** Do not show `pending_confirmation` as “Payment pending” when the order is completed/released, or backfill legacy demo rows.

2. **perspective:** Matt-Aaron / customer · **page/route:** `/clients/[id]` Portal access  
   **issue:** Invite is copy-link only. Matt cannot “send invite” from the product.  
   **expected:** Operators often expect a Send email button.  
   **observed:** Generate → Expires → Copy invite link. Copy in UI: links expire in 48 hours; new invite invalidates the previous.  
   **severity:** P1  
   **recommended future fix:** Optional Resend invite email using the same token URL already returned — do not change token semantics.

3. **perspective:** Customer · **page/route:** `/get-started` → `/get-started/setup` → `/portal/orders/new`  
   **issue:** Marketing preview defaults to **Aged · 30–90 days** and setup redirects to the order form with that freshness. Aged orders then require extra fields (age bucket, shortfall policy) that the landing preview does not collect.  
   **expected:** Prefill should either include those fields or land on Fresh until the customer opts into Aged.  
   **observed:** Local register/setup redirected to `/portal/orders/new?states=TX&qty=100&freshness=aged-30-90&niche=vet`. Review validation requires an age bucket when campaign type is Aged leads.  
   **severity:** P1  
   **recommended future fix:** Map `aged-30-90` into `requestedAgeBucket` or keep the customer on a single “review request” that already has those choices.

4. **perspective:** Customer · **page/route:** `/portal/login` vs `/login`  
   **issue:** Two different login pages. Customers who are sent “the login” to `/login` hit Admin C.O.C. (“Temporary password gate”).  
   **expected:** Customer bookmark is `/portal/login`.  
   **observed:** Deployed `/login` is operator-only. `/portal/login` is email+password.  
   **severity:** P1  
   **recommended future fix:** Customer-facing copy in the SOP (done). Consider a “Looking for the client portal?” link on `/login`.

5. **perspective:** Customer · **page/route:** `/portal/account` after complete  
   **issue:** After **Finish account setup**, fields are no longer editable in the portal. Greeting/lead focus mistakes require an operator.  
   **expected:** Many customers will try to fix a typo themselves.  
   **observed:** Success banner + read-only **Your account** snapshot. No in-session password change either.  
   **severity:** P1  
   **recommended future fix:** Allow PATCH of display name / niches / products after `active`; keep email operator-only.

6. **perspective:** both · **page/route:** unauthenticated portal chrome  
   **issue:** Invite / forgot-password pages branded **LEAD AGENT** on production; signed-in portal says **CUSTOMER PORTAL / Smart Agent 360 Demo**.  
   **expected:** One customer-facing product name.  
   **observed:** `getClientPortalDisplayName()` uses `NEXT_PUBLIC_CLIENT_PORTAL_DISPLAY_NAME`, else “Your business”. Production env currently shows Lead Agent on public portal auth pages.  
   **severity:** P1 (wrong brand in the first minute of invite/reset)  
   **recommended future fix:** Set the env to the name you want customers to see, or derive it from the tenant after token inspect.

### P2 — polish / documentation

7. **perspective:** Customer · **page/route:** `/portal/orders/new`  
   **issue:** Lead type label **N Veteran** for the demo niche token.  
   **expected:** “Veteran”.  
   **observed:** `formatPortalDisplayLabel` does not map `n_veteran` / similar.  
   **severity:** P2  
   **recommended future fix:** Add the token to `NICHE_DISPLAY_NAMES` / portal labels.

8. **perspective:** Matt-Aaron · **page/route:** `/clients`  
   **issue:** Create form is a slug + commas, not a “new customer wizard.” Portal enable is a second page. Easy to create a client and forget portal email.  
   **expected:** A single “invite this person” wizard.  
   **observed:** Create → detail → enable → email → save → generate → copy.  
   **severity:** P2  
   **recommended future fix:** Optional post-create prompt: enable portal + email + generate invite.

9. **perspective:** Customer · **page/route:** `/portal/account` lead focus / product types  
   **issue:** Free-text comma lists with example placeholders. Customers will type novels or leave examples as values.  
   **expected:** Constrained chips matching what fulfillment actually stocks.  
   **severity:** P2  
   **recommended future fix:** Select from the same catalogs the order form uses.

10. **perspective:** both · **page/route:** `/front-office/orders` vs `/fulfillment-ops`  
    **issue:** Two internal shells after submit. Easy to approve in Front Office and think leads should appear.  
    **expected:** One sentence on Front Office (already partly there: activation stays in Fulfillment Ops).  
    **observed:** That banner exists **after** status is `ready`. Before that, operators may hunt.  
    **severity:** P2  
    **recommended future fix:** Keep the SOP Phase 6/7 split; add the same sentence on submitted cards.

11. **perspective:** Customer · **page/route:** `/portal/leads`  
    **issue:** Names are shown; phones masked. Fine for demo; still PII-adjacent for real buyers.  
    **expected:** Released-only, masked contact (this is implemented).  
    **observed:** Copy: “Contact details stay masked.”  
    **severity:** P2 (process: do not screenshot real names into tickets)

12. **perspective:** Matt-Aaron · **page/route:** Admin `/login`  
    **issue:** Single shared password, explicitly “temporary.” Anyone with the password can invite any client.  
    **expected:** Per-operator identity (called out on the page).  
    **severity:** P2 for onboarding UX; P1 as a security program item outside this SOP.

## Five questions

1. **Could Matt onboard a customer without Sam?**  
   **Yes, for portal access**, if Matt has the Admin C.O.C. password: create (or reuse) client → enable portal → save email → copy invite → confirm they can log in. He does **not** need Sam to issue the invite. He **does** need Ops/Sam (or Aaron) for payment confirmation, approve, activate, and release. Live GHL delivery is a separate Aaron/cutover step and is not required for “they can log in.”

2. **Could Aaron onboard a customer without reading code?**  
   **Yes, with this SOP.** Create, portal access, invite, status, Front Office, and Fulfillment Ops are all UI. He does not need to call `/admin/v1` by hand. He still needs to know `/login` vs `/portal/login`, that invites are not emailed, and that `active` is the order gate.

3. **Could a brand-new customer finish setup without asking for help?**  
   **Public path: mostly**, if they start at `/get-started`. Register + setup are labeled. First **Aged** order may stall on extra fields (P1 above). **Invite path: only after** someone pastes the link; the invite page is clear. After setup they cannot fix profile typos themselves.

4. **Where is the single biggest onboarding bottleneck?**  
   **Hand-carrying the invite (no email) plus out-of-band payment confirmation.** The product can create the tenant and the password; it cannot notify the customer or take payment. Those two manual hops are where real clients wait.

5. **Which steps are manual today that should eventually be automated?**  
   Invite email; Stripe or another payment capture; payment → auto-transition off `pending_confirmation`; optional auto-approve for prepaid SKUs; in-portal password change; customer profile edit after complete; per-operator admin login; C.O.C. queue of self-registered `onboarding` tenants (already listed as a follow-up in `docs/architecture/agedvetleads-public-registration.md`).

## Readiness verdict

**YELLOW — usable with documented manual guardrails.**

The portal, invite, public register, profile complete → `active`, order submit, and Front Office approve **exist and work** on the current deploy. Do not treat this as a self-serve checkout. Guardrails: copy the invite; never use production `.env` for local writes; do not flip live delivery from Clients; do not release packages to practice; explain payment pending; use a private window to verify tenant; do not give customers the env-password fallback after conversion.

**Not GREEN:** shared admin password, no invite email, no in-product payment, known Payment-pending-on-completed display, Aged prefill gap.  
**Not RED:** a new customer can be given a working login without a code change.

## Top 5 friction points (by impact)

1. Invite is copy/paste only (48h, one outstanding token) — operators must babysit delivery of the link.  
2. Payment pending is both the real waiting state **and** a misleading badge on already-released demo orders.  
3. Two logins (`/login` vs `/portal/login`) and two entry paths (get-started vs invite) without an operator wizard.  
4. Aged Vet preview → order form extra fields not collected on the landing page.  
5. After “Account setup complete,” customers cannot edit profile or password in-session.

## Video chapters (local recording)

File: `docs/validation/artifacts/client-onboarding-2026-09-13/sa360-client-onboarding-walkthrough.webm`

Timestamps are from the local recorder (banners on screen). Deployed demo delivery (LO-1049 ready / download) was observed separately and was **not** reproduced by releasing a package.

| Timestamp | Section |
| --- | --- |
| 00:00 | Chapter 1 — Customer onboarding (public Aged Vet path) |
| 00:05 | Configure Veteran request preview (no charge) |
| 00:54 | Create account |
| 00:59 | Finish account setup |
| 01:02 | Chapter 2 — Customer portal / account |
| 01:06 | Portal home |
| 01:10 | Orders empty state |
| 01:14 | Leads empty state |
| 01:18 | Account snapshot |
| 01:21 | Place order form |
| 01:29 | Onboarding complete condition |
| 01:32 | Chapter 3 — Matt & Aaron setup |
| 01:40 | Create client |
| 01:46 | Enable portal, generate invite |
| 02:02 | Customer invite password + sign in |
| 02:12 | Chapter 4 — Internal approval / handoff |
| 02:22 | Front Office orders |
| 02:27 | Fulfillment Ops |
| 02:37 | Chapter 5 — Troubleshooting |
| 02:58 | End |

## Tests / builds

Documentation-only. No product test suite was required. Local API `GET /health/db` returned connected against `127.0.0.1`. Admin-coc and API were run with localhost overrides so the production DigitalOcean URL in the developer `.env` was not used for writes.
