# Customer journey final regression (post #96 / #98)

Validation-only rerun of the connected MVP customer journey against current
`origin/master`. No product features were added. No production deploy.
Notification used an injected test transport only (no real customer email).

Confirmed on `origin/master`:

- `2cf9c921e519a62b9a38a552bed7020f2a5c53ff` — #96 customer release notification
- `18f4c773efe75191eb3e13b12e0b9a72145c9a11` — #98 PPL order-linked leads fix (HEAD)

## 1. Current master SHA

`18f4c773efe75191eb3e13b12e0b9a72145c9a11`

## 2. Test client / order

Fresh deterministic identities on local `127.0.0.1:5432/sa360_test`:

- Tenant A: `journey_e2e_a_20260828_214938_qcua` / `journey-e2e-a-20260828_214938_qcua@example.test`
- Tenant B: `journey_e2e_b_20260828_214938_qcua`
- Order: `cmtdhil060006jsjehdrxs5sh` / `LO-1057` (5 NC vet aged leads)
- Export: `cmtdhil1v000djsjelg85jf4c`
- Delivered lead ids: `ppl-beta-evt-clean-vet-NC-200-3` (Clean3) and `ppl-beta-evt-clean-vet-NC-400-4` (Clean4)

Path exercised: create client → enable portal → complete onboarding → place order →
confirm payment → approve → activate → reserve 2 of 5 → commit export → customer
cannot see unreleased package / linked leads → Approve & Release → customer Ready
→ download CSV.

## 3. Fulfillment count result

PASS. After release:

- requested = 5
- delivered / fulfilled = 2
- remaining = 3
- status = `in_progress`
- stored `LeadOrder.fulfilledQuantity` stayed 0 (PPL commit does not increment that column)

Before release, reserved holds were ignored: 5 / 0 / 5 with 2 reserved and 0 committed.

## 4. Linked-leads count / result

PASS. `GET /client/v1/lead-orders/:id/leads` returned exactly 2 rows after release
and 0 rows while allocations were reserved or exported but unreleased.

## 5. CSV count / result

PASS. Customer download `200 text/csv`, filename
`Journey-Valley-Vet_LO-1057_VET_NC_bucket_2-leads.csv`, 1 header + 2 data rows:

- Clean4 / `+15551001004` / `beta.clean.4@example.test`
- Clean3 / `+15551001003` / `beta.clean.3@example.test`

No allocation ids, admin fields, or filesystem paths in the CSV.

## 6. Same 2 leads across all three views

PASS. Fulfillment 5/2/3, linked-leads count 2, CSV row count 2, and the same
identities (`Clean3` / `Clean4` phones and emails, source-lead ids
`ppl-beta-evt-clean-vet-NC-200-3` and `ppl-beta-evt-clean-vet-NC-400-4`) agree.

## 7. Masking / security result

PASS. Linked-lead rows:

- identify the buyer (`journey_e2e_a_20260828_214938_qcua` / Journey Valley Vet)
- do not identify the original aged-inventory owner / beta fixture buyer / supplier ids
- contain no allocation ids
- contain no original owner id
- contain no raw contact fields (`phoneE164` / `email` absent; phones/emails masked)
- contain no internal routing / GHL identifiers (`contactIdGhl` and `subaccountIdGhl` are null)

## 8. Tenant isolation

PASS. Tenant B received 404 on tenant A order, leads, exports, and download.
Download body matched a missing package (`Delivery not found`) with no
`spreadsheetDeliveredAt` leak.

## 9. Notification idempotency / failure result

PASS. Injected test transport only. `RESEND_API_KEY` was unset.

- First Approve & Release: 1 send to tenant A, subject `Your SA360 order is ready`,
  idempotency key `delivery-release:cmtdhil1v000djsjelg85jf4c`, status `sent`
- Service replay + HTTP replay: both ok, `already_sent`, send count stayed 1
- Separate fixture-order release with injected failing send: release still ok,
  `spreadsheetDeliveredAt` set, notify status `failed`

No real customer email was sent.

## 10. Tests / build

| Check | Result |
| --- | --- |
| Connected harness | 41 passed / 0 failed |
| Focused API suites (linked leads, notify, exports, onboarding, lifecycle, FO activate) | 48 passed / 0 failed |
| Focused portal journey suites | 40 passed / 0 failed |
| `@sa360/shared` build | pass |
| `@sa360/api` build (`tsc`) | pass after typing the harness inject helpers |
| `@sa360/admin-coc` Next.js build | pass (pre-existing lint warnings only) |

Local environment note: the Cloud snapshot had applied 70 migrations. This run
generated Prisma client and applied the #96 migration
`20260828180000_delivery_release_customer_notify_v1` to local `sa360` and
`sa360_test` only.

## 11. Remaining manual Alex steps

These are operator / production-session steps, not product blockers for a
controlled spreadsheet-path pilot:

1. Confirm payment in Front Office for the real pilot customer (not this test tenant).
2. Approve the order, activate fulfillment-ops, reserve the intended quantity, commit export.
3. Review the internal CSV, then Approve & Release with `MARK SPREADSHEET DELIVERED`.
4. Confirm the customer portal session (BFF-bound, not the shared portal API key) shows Ready and can download.
5. Before any real email, configure Resend only in the intended non-prod or approved production env. This harness never sent live mail.
6. Do not reuse `@example.test` tenants or the local `sa360_test` rows in production.

## 12. Blockers

None for a controlled customer spreadsheet-path pilot on current master.

Not exercised here (by design): production DigitalOcean, Stripe charging, GHL live
delivery, live Resend, Meta / Synthflow.

## 13. FINAL VERDICT

**READY FOR CONTROLLED CUSTOMER PILOT**
