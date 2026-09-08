# AgedVetLeads configurator → order-form prefill

Status: **Phase 2 handoff** (this PR)  
Depends on: Phase 1 public shell (`docs/architecture/agedvetleads-public-mvp.md`, #126)  
Lane: **Portal**. Does not redesign portal sessions, cookies, or tenants. No Prisma migration. No public order-create API.

This document is the handoff contract. Implement against it; do not persist an unauthenticated order.

---

## 1. Goal

Carry the public `/get-started` preview (states, quantity, Veteran niche, freshness / age bucket) into the existing authenticated `/portal/orders/new` form so the customer can **review and explicitly submit**.

The public page remains marketing + routing. It must not:

- `POST /client/v1/lead-orders` (or the portal BFF)
- reserve inventory
- create a `LeadOrder` row
- collect payment
- expose or accept a GHL / CRM SKU

---

## 2. Handoff mechanism (decision)

**Canonical carrier: allowlisted query string on `/portal/orders/new`.**  
**Same-browser backup: `sessionStorage`**, so invite / password-set in this browser can still restore the preview when the login `next` URL is the generic dashboard.

| Mechanism | Why this, not the alternative |
| --- | --- |
| Query string on `/portal/orders/new` | Survives `/portal/login?next=…` with the existing `next` contract. Middleware already appends `pathname + search`. No new cookie, no new API. Matches Phase 1 §8 item 3. |
| `sessionStorage` key `sa360.agedvet.lead-prefill.v1` | Invite-accept currently lands on `/portal/login?passwordSet=1` without `next`. Public self-registration does not exist (Auth/Account). Storage restores the preview when the customer later opens Place order, and lets login upgrade a bare `/portal` next to the prefill URL. |
| Not a DB draft / anonymous cart | Would persist order-like state without auth and look like a reservation. |
| Not a public POST | Violates “no unauthenticated order.” Alex’s queue must only see `createdByRole=client` submits after sign-in. |
| Not `crmPackage` / SKU in the URL | Customer-facing values only. CRM is server-owned (see §5). |

Prefill is **not** an order. Nothing is reserved until the customer clicks **Submit order request** on the existing review step.

---

## 3. Allowlisted query contract

Path: `/portal/orders/new`

| Param | Meaning | Allowed values | Maps onto existing create body |
| --- | --- | --- | --- |
| `states` | Comma-separated canonical US codes | `sanitizeCanonicalUsStates`, max 20 | `states` |
| `qty` | Requested quantity | Integer 1–1,000,000 | `leadVolume` |
| `freshness` | Public freshness id | `fresh` \| `aged-30-90` \| `aged-90-plus` | `campaignType` plus optional notes (age bucket) |
| `niche` | Veteran niche only | `vet` or `veteran` (case-insensitive) → stored `vet` | `nicheKey` only if that key exists on the account catalog |

Example continue URL from the public page:

```text
/portal/login?next=%2Fportal%2Forders%2Fnew%3Fstates%3DTX%2CFL%26qty%3D250%26freshness%3Daged-30-90%26niche%3Dvet
```

### Freshness mapping (no new API enum)

| `freshness` | `campaignType` (existing) | Notes (presentation → operator) |
| --- | --- | --- |
| `fresh` | `Fresh leads` | none |
| `aged-30-90` | `Aged leads` | `Requested age bucket: 30–90 days` |
| `aged-90-plus` | `Aged leads` | `Requested age bucket: 90+ days` |

Age buckets stay presentation + notes. Do not add a `campaignType` value or Prisma column.

### Reject / normalize

Unknown keys (`crmPackage`, `sku`, `campaignType`, `status`, `clientAccountId`, prices, …) are **dropped**.  
Invalid states are stripped; if none remain, the form requires a new selection.  
Unknown `freshness` / non-Veteran `niche` / non-integer `qty` are dropped; remaining valid fields still apply.  
If `vet` is not in the signed-in account’s niche catalog, do not invent it — leave the account default and treat Veteran as dropped.

The order form must still pass `validatePortalOrderRequestDraft` before review/submit.

---

## 4. Auth / account-creation survival (consume existing contracts)

| Step | What carries the preview |
| --- | --- |
| Public Continue | Writes `sessionStorage` and sets `next` to `/portal/orders/new?…` |
| Unauthenticated hit on `/portal/orders/new?…` | Existing middleware sets `next` to `pathname + search` |
| `/portal/login` already signed in | Existing redirect uses `next` (query preserved) |
| Invite / password set (`next` is `/portal`) | Login form, if `next` is the generic dashboard, upgrades `next` from `sessionStorage` when a valid preview exists. After sign-in they land on the prefilled form. |
| Account setup incomplete | Existing order gate still blocks submit (`ACCOUNT_NOT_READY_TO_ORDER`). Prefill is not a bypass. |
| Different browser / cleared storage | Preview is lost. Expected — we do not persist unauthenticated drafts. |

Do not change session cookies, invite tokens, or tenant scoping. Do not add `next` handling inside `middleware.ts` beyond what Phase 1 already does.

---

## 5. CRM package — AgedVet lead-only stamp (no package redesign)

Hidden `crmPackage = "GHL Starter"` is leftover from Front Office create values. Lead buyers do not choose a GHL SKU.

For **portal customer create** (the only write path this PR touches):

- Prefill and the public page never include `crmPackage`.
- The configure UI stays hidden (`shouldShowPortalOrderCrmPackageStep() === false`).
- `serializePortalOrderCreateBody` and BFF `sanitizeIncomingPortalOrderCreateBody` **stamp** a server-owned value:

  `lead_delivery`

- Any client-supplied GHL / CRM SKU is discarded and replaced with that stamp.
- Front Office create (operator-selected GHL packages) is unchanged.
- Fastify `POST /client/v1/lead-orders` still requires `crmPackage`; the BFF supplies it. Customer POST body shape is otherwise unchanged (`nicheKey`, `states`, `leadVolume`, `campaignType`, optional `productType` / `notes`, `deliveryDestinationLabel`).

This is not a CRM catalog, destination picker, or GHL-delivery redesign.

---

## 6. Submit and confirmation

1. Customer reviews the existing form (prefilled, editable).
2. Customer clicks **Review request**, then **Submit order request**.
3. Existing BFF `POST /api/client-portal/orders` → `POST /client/v1/lead-orders` with `status=submitted` forced server-side.
4. Success UI (same page, no new route) must show:

   - submitted **order number**
   - **requested configuration** (Veteran, states, quantity, freshness / age bucket — customer-safe labels only)
   - **Submitted for review** (not purchased, not approved, not fulfilled)
   - **What happens next** (payment confirmation by the team, then approval, then delivery in the account)
   - a link to **`/portal/account`**
   - existing links to the order and orders list

Clear `sessionStorage` after a successful submit so a later “new order” does not reuse the old preview.

Responsive: desktop and **390px** — full-width stacked actions, no horizontal overflow.

---

## 7. Implementation map

| Area | Files |
| --- | --- |
| This contract | `docs/architecture/agedvetleads-configurator-prefill.md` |
| Parse / serialize / storage / apply | `apps/admin-coc/src/lib/public-site/lead-request-handoff.ts` |
| Public continue href | `lead-request-preview.ts`, `aged-vet-landing.tsx` |
| Order form prefill + confirmation | `portal-order-request-form.tsx`, `portal/orders/new/page.tsx` |
| CRM stamp | `portal-order-request.ts` serialize + sanitize |
| Login next upgrade from storage | `portal-login-form.tsx` (client-only; no session-model change) |

No worker, Prisma, or Fastify route changes.

---

## 8. Risks

- Tampered query strings: allowlist + catalog validation; never trust `crmPackage` / status / tenant ids.
- Invite on another device: preview not restored (no server draft).
- HVAC-only accounts: Veteran niche dropped; customer must pick an allowed lead type.
- `lead_delivery` vs historical `GHL Starter` on older portal orders: operators may see two stored values. Acceptable; do not rewrite history.
- Auth/Account public registration (Phase 1 §5) should keep this query `next` when it ships.
