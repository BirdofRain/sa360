# Customer journey final regression (post #96 / #98 / #100)

Validation-only rerun of the connected MVP customer journey against current
`origin/master` after PR #100. No product features were added. No production
deploy. Notification used an injected test transport only (no real customer
email).

Confirmed on `origin/master`:

- `2cf9c921e519a62b9a38a552bed7020f2a5c53ff` — #96 customer release notification
- `18f4c773efe75191eb3e13b12e0b9a72145c9a11` — #98 PPL order-linked leads fix
- `d65c4fd41b05083e5288702faba2b71192ba0b04` — #100 treat null release-notify status as legacy no-intent (HEAD)

## 1. Current master SHA

`d65c4fd41b05083e5288702faba2b71192ba0b04`

## 2. Sync result

Branch `cursor/customer-journey-final-regression-fb76` merged `origin/master`
(merge commit `8aa784a`). No conflicts. Product files from #100 landed as-is;
this PR still only adds validation harness + report + evidence.

## 3. Connected harness result

**42 passed / 0 failed** on a fresh deterministic client/order.

- Tenant A: `journey_e2e_a_20260828_223613_rfdk` / `journey-e2e-a-20260828_223613_rfdk@example.test`
- Tenant B: `journey_e2e_b_20260828_223613_rfdk`
- Order: `cmtdj6hqp0006jsfq7p2yy63l` / `LO-1064` (5 NC vet aged leads)
- Export: `cmtdj6hsi000djsfqz6b38128`
- Delivered leads: `ppl-beta-evt-clean-vet-NC-200-3` (Clean3) and `ppl-beta-evt-clean-vet-NC-400-4` (Clean4)

Preserved path: onboarding → ready-to-order gate → customer order → payment
confirm → approve → activate → reserve 2 of 5 → unreleased package hidden →
Approve & Release → Ready → secure CSV download.

## 4. #100 legacy replay result

**PASS.** Simulated historical package on a follow-on tenant A order
(`cmtdj6hva000ljsfqqy8jkje0` / export `cmtdj6hvx000pjsfqnkqi2ixc`):

- `spreadsheetDeliveredAt` = `2026-07-01T15:00:00.000Z`
- `customerReleaseNotifyStatus` = `null`

Replay of `markSpreadsheetDelivered` (same key + a second key):

- release ok and idempotent
- `customerNotification.status` = `no_intent`
- reason = `legacy_no_notification_intent`
- injected send count = 0
- `customerReleaseNotifyStatus` remained `null`
- `customerReleaseNotifiedAt` / claimed-at remained null
- deliveredAt, actor, SHA-256, row count, and CSV content unchanged
- customer download still `200 text/csv`

## 5. New-release notification result

**PASS.** Injected transport only. `RESEND_API_KEY` unset.

- Export commit left notify status `null` (no pending until Approve & Release)
- First Approve & Release: 1 send, db status `sent`, subject `Your SA360 order is ready`
- Service + HTTP replay: `already_sent`, send count stayed 1
- Separate injected-fail release still succeeded with notify `failed`

## 6. Fulfillment / linked-leads / CSV agreement

**PASS.** After the new release:

- Fulfillment: requested 5 / delivered 2 / remaining 3
- `GET /client/v1/lead-orders/:id/leads`: exactly 2 buyer-safe rows
- Released CSV: exactly Clean3 + Clean4
- Same two identities across all three views
- Masking: buyer identity only; no allocation ids, original owner id, raw contact, or GHL ids

Reserved-but-unreleased allocations did not appear as delivered leads.

## 7. Tenant-isolation result

**PASS.** Tenant B received 404 on tenant A order, leads, exports, and download.
Download body matched a missing package (`Delivery not found`).

## 8. Builds / tests

| Check | Result |
| --- | --- |
| Connected harness | 42 passed / 0 failed |
| Focused API suites (linked leads, #100 notify, exports, onboarding, lifecycle, FO activate) | 52 passed / 0 failed |
| Focused portal journey suites | 40 passed / 0 failed |
| `@sa360/api` build (`tsc`) | pass |
| `@sa360/admin-coc` Next.js build | pass |

## 9. Validation artifact safety check

**PASS.** Written evidence was scanned before commit. No `RESEND_API_KEY`,
transactional-from, DB password, live/test Stripe keys, private keys, portal
admin keys, or production email domains. Recipients are `@example.test` only.
Synthetic PPL fixture phones (`+1555…`) only.

## 10. Final PR #99 diff

Validation-only files against `origin/master`:

- `apps/api/src/scripts/validate-customer-journey-e2e.ts` (harness)
- `docs/validation/customer-journey-final-regression.md` (this report)
- `docs/validation/customer-journey-e2e-mvp-evidence.json` (run evidence)

No product, schema, or route contract changes.

## 11. Verdict

**READY TO MERGE**
