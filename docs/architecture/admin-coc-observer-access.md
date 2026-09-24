# Admin C.O.C. read-only observer

`SA360_OBSERVER` inspects operational diagnostics. It cannot change production state. Customer portal sessions and Front Office authorization stay separate.

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

## Permission matrix

Default deny for observers. ADMIN keeps the previous operator surface.

| Surface | ADMIN | SA360_OBSERVER | Anonymous |
| --- | --- | --- | --- |
| `/`, `/webhooks`, `/lead-timeline`, `/automation-dashboard`, `/synthflow`, `/lead-fulfillment`, `/lead-inventory`, `/source-intake`, `/routing-dry-run`, `/delivery-readiness` | Allow | Allow (reads) | Login redirect |
| `/clients`, `/flags`, `/settings`, `/ghl-connections`, `/fulfillment-ops`, `/direct-delivery-demo`, `/review`, `/source-intake/imports`, planning, support | Allow | **403** | Login redirect |
| `/agent-workspace`, `/action-center` | Allow | **403** | Login redirect |
| `/front-office/**` | Existing Front Office rules | Not an admin session; chooser or 401 | Chooser or 401 |
| `/portal/**`, `/get-started/**` | Unchanged portal/marketing rules | Unchanged | Unchanged |
| `GET /api/lead-inventory/review/summary`, `.../items`, `.../items/:id`, `.../actions/:requestId` (not preview/commit) | Allow | Allow | **401** |
| Other `/api/**` admin BFF routes, including fulfillment, agent workspace, action dashboard, imports | Allow | **403** | **401** |
| Observer read server actions (`loadWebhookDetailAction`, `loadLeadTimelineAction`, `loadSynthflowDetailAction`, `loadSynthflowOutboundDetailAction`, `loadSourceLeadDetailAction`, `loadDeliveryPlanForDecisionAction`, `loadDeliveryRuntimeModeAction`) | Allow | Allow | Login redirect |
| Other Admin C.O.C. server actions (approve, reserve, deliver, flags, OAuth, clients, credentials) | Allow | **403** (`AdminCocForbiddenError` plus admin-key refusal) | Login redirect |

Admin API calls made with `x-sa360-admin-key` are allowlisted GETs under `/admin/v1/coc/*`, automation dashboard, lead-inventory summary/facets/lots/review reads, source-lead list/detail, routing dry-run decision reads, delivery-readiness, and delivery-runtime-mode status. Posts, client records, GHL/OAuth, kanban, support tickets, fulfillment mutations, and export downloads are denied before the key is attached.

The UI shows **Read-only Observer**, lists only approved pages, and hides mutation controls. The server checks are the enforcement.
