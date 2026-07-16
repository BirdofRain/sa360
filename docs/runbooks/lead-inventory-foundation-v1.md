# Lead inventory foundation v1 runbook

## Scope

Read-only inventory inspection surfaces. No production inventory creation, import writes, reservations, allocations, payments, or GHL delivery changes.

## Inspect inventory (admin)

1. Open **Lead Inventory** in admin C.O.C. (`/lead-inventory`)
2. Confirm summary cards: available, reserved, committed, active lots
3. Review state-by-age matrix for supply/demand/unmet cells
4. Review lots panel for derived counts per lot

API equivalents (admin key required):

- `GET /admin/v1/lead-inventory/summary`
- `GET /admin/v1/lead-inventory/facets`
- `GET /admin/v1/lead-inventory/items`
- `GET /admin/v1/lead-inventory/lots`

## Import preview (read-only)

`POST /admin/v1/lead-inventory/import-preview`

- Finds `SourceLeadEvent` rows **without** a `LeadInventoryItem`
- Uses provider/source `generatedAt` — not `receivedAt` as a silent fallback
- Normalizes state, evaluates proof/verification readiness
- Groups eligible/ineligible candidates by state + age band
- Returns masked IDs only
- **Writes nothing**

Max `limit`: 500.

## Reading blockers

Common availability blockers:

| Blocker | Meaning |
| --- | --- |
| `lot_not_active` | Lot paused/archived/quarantined |
| `item_not_available` | Item status not `available` |
| `generated_at_missing` | No authoritative provider timestamp |
| `state_missing` | Normalized state absent |
| `proof_not_ready` | Proof not `PROOF_ATTACHED` |
| `verification_not_passed` | Verification not `PASSED` |
| `duplicate_risk` | Duplicate status not `UNIQUE` |
| `active_reservation` | Allocation in reserved/delivering/review_required |
| `fulfillment_limit_reached` | `fulfillmentCount >= maxFulfillments` |

## Demand vs supply

Facet rows include:

- `available` / `reserved` / `blocked` supply counts
- `demand` from active `LeadOrderLine` unmet quantity
- `unmet` = max(demand - supply, 0)
- `coverageRatio` = supply / demand when demand > 0

No automatic matching occurs in v1.

## Age-band changes

- Definitions live in `LeadAgeBandDefinition` (seeded `v1` in migration)
- Age is always derived at evaluation time from `generatedAt`
- After changing bands, re-run facet/summary endpoints and verify matrix counts

## Disable UI safely

Remove or hide nav entries:

- Admin: `Lead Inventory` (`apps/admin-coc/src/lib/nav.ts`)
- Front Office: `Leads on Demand` (`apps/admin-coc/src/lib/front-office/nav.ts`)

API routes remain but require existing admin/client auth.

## Explicit non-goals in v1

- No production inventory rows created
- No purchase/payment/Stripe
- No reservation/release buttons
- No delivery or GHL mutations
- No LeadCapture API calls
- No automatic aged-lead import

## LeadCapture parking

PR #38 remains open. Trust sync/attachment/polling stay disabled while LeadCapture Data API list endpoint returns HTTP 500.

## Merge blocker

Do not merge/deploy this branch until PR #38 is merged and this branch is rebased onto resulting master, then migration validation is repeated on the combined chain.
