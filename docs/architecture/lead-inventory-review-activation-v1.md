# Lead Inventory Review & Activation v1

Guarded admin workflow to move imported inventory from `pending_review` to
`available`, `quarantined`, or `rejected`. Stacked on aged ingestion (#40).

## Review-state transitions

| From | To | Requires |
| --- | --- | --- |
| `pending_review` | `available` | Full eligibility pass + confirmation |
| `pending_review` | `quarantined` | Reason code + confirmation |
| `pending_review` | `rejected` | Reason code + confirmation |

Disallowed: reverse transitions; mutating reserved/committed/fulfilled; any
automatic or background transition.

## Availability eligibility

A pending item may become available only when all of the following hold:

1. Status is `pending_review`
2. Valid `normalizedState` and `generatedAt`
3. Active age-band classifies the item
4. Recognized `sourceProvider` and canonical `sourceLane`
5. Inventory lot and source lead event exist
6. Import/lot provenance present
7. Identity normalization present under canonical rules
8. Duplicate/verification status explicitly safe (absent = blocked)
9. No quarantine reason; not expired/withdrawn/reserved/etc.
10. No conflicting allocation or delivery history
11. `fulfillmentCount` ≤ `maxFulfillments`
12. Required commercial fields present

Absent evidence fails closed. Proof status is informational only and must not be
fabricated.

## Feature flag

`SA360_LEAD_INVENTORY_REVIEW_ENABLED` — default **false**. Mutations fail closed
when disabled. UI shows a disabled banner.

## API (admin auth required)

| Method | Path | Writes |
| --- | --- | --- |
| GET | `/admin/v1/lead-inventory/review/summary` | no |
| GET | `/admin/v1/lead-inventory/review/items` | no |
| GET | `/admin/v1/lead-inventory/review/items/:itemId` | no |
| POST | `/admin/v1/lead-inventory/review/actions/preview` | no (`writesPerformed: 0`) |
| POST | `/admin/v1/lead-inventory/review/actions/commit` | yes (guarded) |
| GET | `/admin/v1/lead-inventory/review/actions/:requestId` | no (recovery) |

### Confirmation phrases

- Make available: `MAKE REVIEWED INVENTORY AVAILABLE`
- Quarantine: `QUARANTINE SELECTED INVENTORY`
- Reject: `REJECT SELECTED INVENTORY`

Max **100** items per action.

## Idempotency and concurrency

- Unique `requestId`; identical replay returns existing result
- Conflicting `requestId` payload fails closed
- Commit re-evaluates eligibility; conditional update on `pending_review`
- Stale status → item blocked, never overwritten
- Ambiguous transport → recover via `requestId`; no auto-retry

## Audit

Append-only `LeadInventoryReviewAction` + `LeadInventoryReviewItemResult`.
No contact PII, raw payloads, IP, consent text, or certificate URLs.

## UI

Admin C.O.C. `/lead-inventory` → **Review Queue** section alongside aged import
wizard. Summary cards, filters, table, detail, preview/commit with exact phrase.

## Client / commercial boundary

Activation only changes supply eligibility. It does **not** allocate, reserve,
fulfill, charge, deliver, call GHL, LeadCapture, or attach trust.

Client catalog continues to omit internal IDs/costs; `unitPriceCents` remains null.

## Out of scope

- Production import/activation
- Background jobs / pollers
- Automatic availability after CSV import
- Payment, allocation, delivery, GHL, LeadCapture, trust attach

## Fail-closed / rollback

Disable `SA360_LEAD_INVENTORY_REVIEW_ENABLED`. Additive migration only; leave
applied audit rows in place. No destructive rollback of review history.

## Test plan

Eligibility blockers, preview zero-writes, commit phrases/idempotency/concurrency,
admin auth, disabled flag, migration fresh/upgrade/idempotent, admin-coc queue.
