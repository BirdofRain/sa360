# ADR: LF2 Guarded GHL Canary Delivery (PR B)

Status: accepted (manual admin-only live canary)

## Context

PR A merged atomic reservation, provider-neutral `DeliveryAttempt`, simulation-only orchestration, and hardened claim/commit semantics. PR B adds manually guarded live GHL delivery for `ghl.crm.v1` without automatic fulfillment.

## Decision

1. **Register `ghl.crm.v1` in the LF2 execution adapter registry** with simulation support and live execution routed through the existing GHL transport stack.
2. **LF2 deny-by-default allowlists** are independent from legacy optional `SA360_LIVE_CANARY_ALLOWED_DESTINATIONS`:
   - `SA360_LF2_EXECUTION_ENABLED`
   - `SA360_LF2_GHL_CANARY_ENABLED`
   - `SA360_LF2_GHL_ALLOWED_CLIENT_IDS`
   - `SA360_LF2_GHL_ALLOWED_LOCATION_IDS`
   - `SA360_LF2_GHL_ALLOWED_ORDER_IDS`
   - `SA360_LF2_GHL_ALLOWED_SOURCE_LANES`
   Missing, empty, or non-matching values deny execution.
3. **Manual admin endpoints only:**
   - `GET /admin/v1/fulfillment-execution/instructions/:instructionId/ghl-live/canary/preflight`
   - `POST /admin/v1/fulfillment-execution/instructions/:instructionId/ghl-live/canary`
4. **Reuse existing guards:** environment runtime ceiling, DB-backed delivery mode, `assertLiveDeliveryAllowed()`, GHL OAuth/token refresh, request builders, and `executeLiveCanaryGhlSteps()`.
5. **LF2 attempt lifecycle:** claim with `executionMode=live` → external GHL call outside DB transaction → `commitFulfillmentSuccess()` on confirmed required-path success; ambiguous failures become `unknown_outcome`.
6. **No automatic fulfillment.** No intake/outbox auto-promotion. No multi-client or multi-location enablement by default.

## Non-goals

- Automatic LF2 execution worker
- Replacing `GhlLiveDeliveryRun` as legacy plan audit source
- Auto-retry from `unknown_outcome`
