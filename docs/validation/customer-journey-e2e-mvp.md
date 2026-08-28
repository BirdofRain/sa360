# Customer journey E2E — MVP validation

**Lane:** validation only. No product redesign. No deploy. No production data.  
**Email:** not exercised (separate delivery-release notification lane).  
**Base:** `origin/master` `@ dad1c748f39739ad8dec5d5c151ae08c58cb157a`  
(`Complete customer next-action home with released-delivery contract` #95)

Harness: `apps/api/src/scripts/validate-customer-journey-e2e.ts`  
Evidence: `docs/validation/customer-journey-e2e-mvp-evidence.json`

## Environment

| Item | Used |
| --- | --- |
| App | Real Fastify `buildApp()` via `inject` (same HTTP routes as a local API process) |
| Postgres | Local `127.0.0.1:5432/sa360_test` only |
| Redis | Local `127.0.0.1:6379` present; not required for this path |
| Inventory | Existing PPL aged-beta fixtures (`seedPplAgedBetaFixtures`) |
| Portal copy | Published journey copy applied to live API payloads; existing admin-coc presenter tests corroborate |

### Real services that **can** be exercised locally

- Admin client create / portal provision (`POST/PATCH /admin/v1/clients`)
- Client account + onboarding (`GET/PATCH /client/v1/account`, `POST .../complete-onboarding`)
- Client order intake (`POST /client/v1/lead-orders`)
- Payment confirm + approve (`POST /admin/v1/lead-orders/:id/confirm-payment`, `.../approve`)
- Fulfillment Ops activate / PPL select / export / internal CSV / Approve & Release
- Customer released exports + CSV download
- Tenant-scoped 404s

### Real services that **cannot** be exercised in this environment

- Production DigitalOcean / remote Postgres / Redis
- Stripe / card charging (payment is Alex attestation)
- GHL live CRM delivery
- Resend / transactional email (separate lane)
- Meta / Synthflow / Logtail
- Shared-password portal **browser** login (verified locally after the API run; see screenshots)

Required operator flags for fulfillment (already in the harness):

- `SA360_PPL_SELECTION_ENABLED=true`
- `SA360_PPL_CSV_EXPORT_ENABLED=true`
- Fulfillment mode used: `pay_per_lead` + `pooled_matching` (backfilled on activate)

## Test identities (clean connected run)

| Role | Id |
| --- | --- |
| Tenant A | `journey_e2e_a_20260828_165136_bmyv` |
| Tenant A email | `journey-e2e-a-20260828_165136_bmyv@example.test` |
| Tenant B | `journey_e2e_b_20260828_165136_bmyv` |
| Paused tenant | `journey_e2e_p_20260828_165136_bmyv` |
| Order | `cmtd6vb8u0006jsl8r0imltm0` / `LO-1051` |
| Export | `cmtd6vbah000djsl8j2z8r373` |

## Journey table

| STEP | ACTION | EXPECTED STATE | ACTUAL STATE | PASS/FAIL | EVIDENCE |
| --- | --- | --- | --- | --- | --- |
| 2.1 | Alex `POST /admin/v1/clients` | `onboarding`, portal off | `201 status=onboarding portal=false` | PASS | evidence.json 2.1 |
| 2.2 | Customer `GET /client/v1/account` before portal | 403 `PORTAL_DISABLED` | 403 portal not enabled | PASS | 2.2 |
| 2.3 | Alex PATCH portal enable + login email | portal on; still `onboarding` | portal=true; email set; status onboarding | PASS | 2.3 |
| 2.4 | `GET /client/v1/portal-context` by email | tenant A, portal enabled | 200 id matches | PASS | 2.4 |
| 3.1 | `GET /client/v1/account` | `readyToOrder=false` | ready=false status=onboarding | PASS | 3.1 |
| 3.2 | Customer PATCH `status` / `portalEnabled` | 400 strict schema | 400 | PASS | 3.2 |
| 3.3 | complete-onboarding without niche/product | 400 `PROFILE_INCOMPLETE` | 400 PROFILE_INCOMPLETE | PASS | 3.3 |
| 3.4 | Onboarding POST order | 409 `ACCOUNT_NOT_READY_TO_ORDER` | 409 | PASS | 3.4 |
| 3.5 | complete-onboarding with name + niche + product | `active`, `readyToOrder=true` | 200 active/true | PASS | 3.5 |
| 3.6 | Tenant B PATCH own profile | A display name unchanged | A still Journey Valley Vet | PASS | 3.6 |
| 3.7 | Paused tenant POST order | 409 not ready | 409 | PASS | 3.7 |
| 4.1 | `POST /client/v1/lead-orders` (portal intake) | `submitted` + `pending_confirmation` | 201 LO-1051 submitted/pending | PASS | 4.1 |
| 5.1 | Approve before payment | 409 `payment_confirmation_required` | 409 | PASS | 5.1 |
| 5.2 | PATCH `submitted` → `active` | 409 `submitted_cannot_activate` | 409 | PASS | 5.2 |
| 5.3 | Confirm payment | payment `confirmed`; status still `submitted` | confirmed + submitted | PASS | 5.3 |
| 5.4 | Approve | `ready`; payment still confirmed | ready + confirmed | PASS | 5.4 |
| 6.1 | Fulfillment Ops activate | `active`; `pay_per_lead` / `pooled_matching`; qty 5 | 200 those fields set | PASS | 6.1 |
| 6.2 | Activate unapproved order | 409 `submitted_cannot_activate` | 409 | PASS | 6.2 |
| 7.1 | Selection commit qty 2 of 5 | 2 reserved allocations | 200 selected=2 | PASS | 7.1 |
| 7.2 | Customer fulfillment after reserve | 5 / 0 / 5; reserved ≠ delivered | requested=5 fulfilled=0 remaining=5 | PASS | 7.2 |
| 8.1 | Export commit | package exists; not released | exportId set; deliveredAt null | PASS | 8.1 |
| 8.2 | Internal Alex CSV download | 200 csv; delivered header false | 200 text/csv delivered=false | PASS | 8.2 |
| 8.3 | Customer export list | `items=[]` | 200 [] | PASS | 8.3 |
| 8.4 | Customer download before release | 404 `Delivery not found` | 404 same error | PASS | 8.4 |
| 8.5 | Dashboard before release | not “Your order is ready” | `order_in_progress` | PASS | 8.5 |
| 9.1 | Approve & Release | `spreadsheetDeliveredAt` set; identities; committed; not auto-complete | deliveredAt set; 2 identities; 2 committed; status `active` | PASS | 9.1 |
| 10.1 | Customer fulfillment after release | 5 ordered / 2 delivered / 3 remaining; ignore stored counter | fulfillment 5/2/3 `in_progress`; stored `fulfilledQuantity=0` | PASS | 10.1 |
| 10.2 | Customer exports | one released package; downloadable | 1 item, `downloadAvailable` | PASS | 10.2 |
| 10.3 | Dashboard ready | “Your order is ready” + Download | `order_ready` | PASS | 10.3 |
| 10.4 | Customer CSV | safe csv; 2 rows; no internals | `text/csv`; filename `Journey-Valley-Vet_LO-1051_VET_NC_bucket_2-leads.csv`; 2 lead rows; leakHits=[] | PASS | 10.4 |
| 11.1 | Tenant B isolation | 404 on A order/leads/exports/download; download ≡ missing | all 404; download error `Delivery not found` | PASS | 11.1 |
| 12.1 | Account API failure copy | not “Complete your account” | `We couldn't load your account status.` | PASS | 12.1 |
| 12.2 | Orders API failure copy | not “No orders” | `We couldn't load your orders.` | PASS | 12.2 |
| 12.3 | Export lookup failure | does not fabricate Ready | `order_in_progress` | PASS | 12.3 |

## Numbered results

1. **Current master SHA:** `dad1c748f39739ad8dec5d5c151ae08c58cb157a`
2. **Environment:** local Fastify + local `sa360_test` Postgres + local Redis; PPL flags on; no production.
3. **Test client:** `journey_e2e_a_20260828_165136_bmyv` / `journey-e2e-a-20260828_165136_bmyv@example.test`
4. **Test order:** `cmtd6vb8u0006jsl8r0imltm0` (`LO-1051`), 5 NC vet aged leads requested
5. **Onboarding:** `readyToOrder` false → complete with display name + `vet` + `aged_leads` → `active` / `readyToOrder` true. Status write rejected. Other tenant cannot change A.
6. **Order request:** client POST → `submitted` + `pending_confirmation`. Onboarding and paused accounts 409.
7. **Payment:** confirm-payment → `confirmed`; status remains `submitted`.
8. **Approval:** approve → `ready`. Pending-payment approve denied. `submitted` → `active` denied.
9. **Activation:** fulfillment-ops activate → `active`, backfills `pay_per_lead` / `pooled_matching` / `requestedQuantity=5`. Unapproved activate denied.
10. **Fulfillment:** reserved 2 of 5. Customer still sees 0 delivered until release. After release: 2 committed / 3 remaining / `in_progress`. Stored `LeadOrder.fulfilledQuantity` stayed 0.
11. **Pre-release visibility:** package exists; Alex CSV works; customer list empty; customer download 404; dashboard not Ready. Finalizing is **not** shown for this path because reserved holds are not committed (honest; fulfillment `not_started` until release).
12. **Release:** `mark-spreadsheet-delivered` with `MARK SPREADSHEET DELIVERED` set `spreadsheetDeliveredAt`, wrote `BuyerDeliveredIdentity`, committed allocations. Order stayed `active` (not auto-completed).
13. **Customer download:** 200 `text/csv; charset=utf-8`; filename `Journey-Valley-Vet_LO-1051_VET_NC_bucket_2-leads.csv`; rows Clean4/Clean3; buyer columns only; no allocation ids, paths, or admin fields.
14. **Tenant isolation:** B gets 404 for A’s order, leads, export list, and download. Download body matches missing package (`Delivery not found`).
15. **Failure states:** account fail ≠ Complete your account; orders fail ≠ No orders; export fail ≠ Ready; unreleased download 404; pending payment cannot approve; unapproved cannot activate; not-ready cannot order.
16. **Manual Alex steps still required:** enable portal + share login URL/password; confirm Stripe outside SA360 then Confirm payment; Approve; Activate in Fulfillment Ops (PPL flags on); select/reserve; commit export; internally review CSV; type `MARK SPREADSHEET DELIVERED` / Approve & Release. Email is a separate lane.
17. **Bugs/blockers discovered:** none that break create → pay → approve → activate → export → release → customer Ready/CSV. Follow-up (not a spreadsheet-path blocker): after PPL release, `GET /client/v1/lead-orders/:id/leads` returned `[]` even with 2 committed allocations, so order-detail “Leads from this order” stayed empty. Fulfillment counts (5/2/3) and the released CSV were still correct. Root cause: the linked-leads presenter joins source-lead delivery read models and drops rows whose resolved client id is not the buyer (typical of aged inventory events). Known operational constraints: shared portal password; no Stripe; PPL feature flags; Finalizing copy does not appear on reserved-only PPL batches; client intake is still free-text until ops activate.
18. **Fixes required before production pilot?** No code fix required for the connected Ready/download path. Optional before a broader pilot: surface PPL committed allocations on the order-linked leads list. Pilot still needs PPL flags, aged inventory, Alex runbook, and the email lane if customers must be notified out of band.
19. **FINAL VERDICT: READY FOR CONTROLLED CUSTOMER PILOT**

## Browser confirmation (local portal)

After the API run, local API (`:3010` → `sa360_test`) + `admin-coc` (`:3000`) were started. Customer signed in at `/portal/login` with the shared MVP password.

- Dashboard hero: **Your order is ready** / Valley Vet Portal — LO-1051 / Download spreadsheet
- Order detail: 2 of 5 delivered, remaining 3; released CSV + Download spreadsheet
- Browser downloaded `Journey-Valley-Vet_LO-1051_VET_NC_bucket_2-leads.csv` (295 B, 2 lead rows)
- Orders list shows LO-1051 Active

<img src="/opt/cursor/artifacts/portal-dashboard-order-ready.webp" alt="Portal dashboard Your order is ready" />
<img src="/opt/cursor/artifacts/portal-order-detail-partial-delivery.webp" alt="Order detail 2 of 5 and released CSV" />
<img src="/opt/cursor/artifacts/portal-orders-csv-downloaded.webp" alt="Orders list with downloaded CSV" />

## Risks

- Shared `CLIENT_PORTAL_API_KEY` can address any enabled tenant by `clientAccountId`. Customer isolation in production is the BFF session binding, not the raw portal key.
- PPL select/export no-op unless the two feature flags are true.
- Email “Your order is ready” was not a prerequisite and was not validated here.
