# Admin C.O.C. read-only observer

`SA360_OBSERVER` inspects operational diagnostics. It cannot change production state. Customer portal sessions and Front Office authorization stay separate.

Observer access is **global across clients**. It is an internal diagnostic role and is **not intended for customers**.

## Session compatibility

Signed cookies stay version `ac1` (`typ: admin_coc`), httpOnly, `sameSite=lax`, `secure` in production.

| Token | Result |
| --- | --- |
| `ac1` body with no `role` | **ADMIN** (tokens issued before roles) |
| `role: "ADMIN"` | ADMIN |
| `role: "SA360_OBSERVER"` | Observer allowlist |
| Any other `role` | Rejected |
| Literal `ok`, bad signature, expired, portal token | Rejected |

New admin logins stamp `role: "ADMIN"`. Observer logins stamp `SA360_OBSERVER` only when `ADMIN_COC_OBSERVER_PASSWORD` is set, distinct from `ADMIN_COC_PASSWORD`, and `ADMIN_COC_SESSION_SECRET` can sign. If the observer password is absent, observer login stays unavailable. Local dev with `ADMIN_COC_PASSWORD` unset remains fail-open as ADMIN.

## Environment (names only)

- `ADMIN_COC_PASSWORD`
- `ADMIN_COC_SESSION_SECRET`
- `ADMIN_COC_OBSERVER_PASSWORD`

Do not put these values in `NEXT_PUBLIC_*` variables.

## Path rules

A path is authorized only when it is already canonical and matches an entry below. Dot segments (`.` / `..`), percent-encoding, backslashes, null bytes, empty segments, and trailing slashes are rejected. The gate does not rewrite `/admin/v1/coc/../clients` onto another route and then allow it. Future pages and API routes are denied until they are added explicitly.

## Approved document pages (exact)

`/`, `/webhooks`, `/lead-timeline`, `/automation-dashboard`, `/synthflow`, `/lead-fulfillment`, `/lead-inventory`, `/source-intake`, `/routing-dry-run`, `/delivery-readiness`.

`/source-intake/imports` and every other child path stay denied. Server Actions keep their own checks even when the surrounding page is allowed.

## Approved admin API GETs (exact)

Static:

- `/admin/v1/coc/summary-metrics`
- `/admin/v1/coc/webhook-requests`
- `/admin/v1/coc/lead-timeline`
- `/admin/v1/coc/synthflow-requests`
- `/admin/v1/coc/synthflow-outbound-results`
- `/admin/v1/coc/lead-fulfillment/overview`
- `/admin/v1/automation-dashboard/summary`
- `/admin/v1/automation-dashboard/workflow-progression`
- `/admin/v1/automation-dashboard/appointments`
- `/admin/v1/automation-dashboard/signal-health`
- `/admin/v1/automation-dashboard/accounts`
- `/admin/v1/lead-inventory/summary`
- `/admin/v1/lead-inventory/facets`
- `/admin/v1/lead-inventory/lots`
- `/admin/v1/lead-inventory/review/summary`
- `/admin/v1/lead-inventory/review/items`
- `/admin/v1/source-leads`
- `/admin/v1/routing/dry-run-stats`
- `/admin/v1/routing/dry-run-decisions`
- `/admin/v1/routing/dry-run-master-clients`
- `/admin/v1/delivery-readiness`
- `/admin/v1/delivery-runtime-mode`

One validated id (`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`):

- `/admin/v1/coc/webhook-requests/:id`
- `/admin/v1/coc/synthflow-requests/:id`
- `/admin/v1/coc/synthflow-outbound-results/:id`
- `/admin/v1/lead-inventory/review/items/:itemId`
- `/admin/v1/lead-inventory/review/actions/:requestId` (GET status lookup only)
- `/admin/v1/source-leads/:id`
- `/admin/v1/routing/dry-run-decisions/:id/delivery-plan`
- `/admin/v1/routing/dry-run-decisions/:id/duplicate-risk`

POST, PUT, PATCH, and DELETE are denied. New GET paths are denied until listed.

## Approved BFF reads

`unauthorizedAdminCocBffResponse` checks the session and, for observers, the request URL. Omitting the request denies the observer. `withAdminCocBff` does the same. Middleware is not required for that 403.

Allowed GET/HEAD:

- `/api/lead-inventory/review/summary`
- `/api/lead-inventory/review/items`
- `/api/lead-inventory/review/items/:itemId`
- `/api/lead-inventory/review/actions/:requestId` (status lookup; the id must match the charset above)

POST `/api/lead-inventory/review/actions/preview` and `/commit` stay denied. Portal, Front Office, and health routes do not use this Admin C.O.C. gate.

## Approved server actions

- `loadWebhookDetailAction`
- `loadLeadTimelineAction`
- `loadSynthflowDetailAction`
- `loadSynthflowOutboundDetailAction`
- `loadSourceLeadDetailAction`
- `loadDeliveryPlanForDecisionAction`
- `loadDeliveryRuntimeModeAction`

Every other privileged action calls `requireAdminCocAdminSession()` and throws `AdminCocForbiddenError` for an observer before the admin API key is attached.

## Diagnostic fields returned to observers

Source-lead list and detail, webhook list and detail, lead timeline, and Synthflow inbound/outbound responses are projected on the server before they reach the browser. ADMIN responses stay complete.

Kept: internal ids, source, campaign, timestamps, processing status, inventory creation result, deduplication status, routing outcome, error codes, destination account/location ids.

Removed for observers: `rawPayloadJson`, `normalizedPayloadJson`, `enrichmentMetadataJson`, unredacted `deliveryResultJson` (only mode/status/ok/error/errorCode/inventoryCreated/inventoryLotId/dedupeStatus/httpStatus), emails, phone numbers, names, webhook and Synthflow bodies, transcripts, and `payloadRedacted`. `routingResultJson` and `duplicateRiskJson` keep operational keys only. Candidate matches and response bodies are omitted.

## Permission matrix

| Surface | ADMIN | SA360_OBSERVER | Anonymous |
| --- | --- | --- | --- |
| Exact diagnostic pages listed above | Allow | Allow | Login redirect |
| Other Admin C.O.C. pages, including `/source-intake/imports`, `/clients`, `/flags`, `/agent-workspace` | Allow | **403** | Login redirect |
| `/front-office/**` | Existing Front Office rules | Not an admin session | Chooser or 401 |
| `/portal/**`, `/get-started/**` | Unchanged | Unchanged | Unchanged |
| Approved BFF GETs | Allow | Allow | **401** |
| Other privileged `/api/**` BFF routes | Allow | **403** (handler, even without middleware) | **401** |
| Approved read server actions | Allow | Allow (projected) | Login redirect |
| Other Admin C.O.C. server actions | Allow | **403** | Login redirect |
| Approved admin API GETs | Full payload | Projected diagnostic payload | **401** before the key |
| Any other admin API call | Allow | **403** before `x-sa360-admin-key` | **401** |

The UI shows **Read-only Observer** and hides mutation controls. The server checks are the enforcement.
