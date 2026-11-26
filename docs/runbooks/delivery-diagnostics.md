# Delivery diagnostics (read-only)

Admin-only, read-only view of source intake, Google Sheets delivery, GoHighLevel delivery, and delivery infrastructure. It exists so an operator can answer "what happened to this lead's delivery" from stored receipts without a database console.

It does not change delivery. No route enqueues work, retries a run, replays a webhook, changes a flag, or calls GoHighLevel, Google, or Meta. The GHL executor, opportunity creation, retry logic, workflow enrollment, and client configuration are not touched.

## Routes

All routes are `GET` under `/admin/v1/delivery-diagnostics` and need the `x-sa360-admin-key` header. Client keys, workspace keys, cookies, and bearer tokens do not authenticate here.

| Route | Purpose |
| --- | --- |
| `/summary?window=24h\|7d&clientAccountId=&campaignId=` | Intake, Sheets, GHL, and infrastructure sections plus an `attention` list and explicit `coverage` statements |
| `/ghl-runs?clientAccountId=&status=&window=&limit=&cursor=` | Run index for finding a run id. Needs `clientAccountId` or `status`. Newest first, keyset cursor, at most 50 per page |
| `/ghl-runs/:runId` | One run: contact, opportunity, workflow, and every step with status, requirement, sanitized error code and HTTP status. Recorded workflow requirement, retry disposition, and the destination configuration |

Windows are the two named windows only. There is no free-form date range. Identifiers are validated (`[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}`) and unknown query parameters are rejected.

## Operator CLI

```bash
export SA360_ADMIN_KEY=...            # environment only. The CLI rejects --admin-key.
export SA360_API_BASE_URL=https://<api-host>
node scripts/delivery-diagnostics.readonly.mjs summary --window 24h
node scripts/delivery-diagnostics.readonly.mjs summary --client <clientAccountId> --window 7d
node scripts/delivery-diagnostics.readonly.mjs runs --client <clientAccountId> --status failed
node scripts/delivery-diagnostics.readonly.mjs run <runId> [<runId> ...]
```

The CLI sends GET only, requires HTTPS (plain HTTP only for loopback), follows no redirects, and never prints the key. Exit code `1` means the API answered with an error status. `2` means a usage error.

To read a specific incident, resolve the run ids first with `runs --client <id>` (or take them from the Admin C.O.C.), then call `run <id>`.

## What each section means

### Intake

Counts come from SA360's own tables (`SourceLeadEvent`, `WebhookRequestLog`). They show what SA360 received and what it did with it. They are not independent source totals. LeadCapture, Zapier, and Meta do not report their own totals into SA360, so a lead that never reached SA360 is invisible here. Treat any comparison with a source-side count as a manual reconciliation.

### Sheets

Success is the existing `canonicalCompanySheetsDelivery`: a succeeded campaign job with written rows and a finish time. A job marked `succeeded` without durable rows is reported as `missingProof`. Delivery failure is `retryable` with a code, or `uncertain`. A `failed` lead job is a person-gate hold settled before any Google call; it appears in `jobsByStatus` only. Expected intent holds (`awaiting_setup`, `needs_explicit_schedule`, `duplicate_held`, `review_held`, `assessment_held`, `assessment_failed`) are counted separately and are not failures. When a `clientAccountId` is given, `monitorPreview` shows what the existing monitor rules would find. Nothing is stored or sent.

### GHL

The unit is one `GhlAssociationDispatchOutbox` row. Each is classified from its stored run and steps with the existing canonical predicates:

| Class | Meaning |
| --- | --- |
| `delivered_complete` | Canonical delivery |
| `delivered_optional_warnings` | Contact and required path complete. An optional owner, note, or field step failed or was skipped with a reason |
| `contact_delivered_required_workflow_incomplete` | Verified contact, but the workflow was required (recorded on the run) and not enrolled |
| `contact_delivered_workflow_requirement_unrecorded` | Verified contact, and the run did not record whether the workflow was required. The requirement is not guessed |
| `terminal_required_step_failure` | The stored run failed and no automatic retry is pending, so the drain will not send it again. This includes a failed run whose outbox row is `uncertain` |
| `retryable_failure` | Failed, and an automatic retry is pending |
| `pending`, `pending_overdue`, `in_flight`, `held_stale_executing` | Outbox state |
| `held_uncertain` | Outbox `uncertain` with no settled run to read, so the outcome is unknown |
| `intentional_non_delivery` | Shadow, disabled, not approved, location mismatch, no destination, or a non-active client. Not a failure |
| `duplicate_skipped` | Duplicate decision |
| `settled_without_run_unexplained` | Settled with no run, a live destination, and an active client. Needs investigation |

The stored run decides the class; the outbox status is reported beside it. Each attention item carries `retryDisposition` and `outboxStatus` separately from `kind`. `requiredWorkflow` counts come from the canonical workflow reasons, so a required workflow skipped after a failed step counts as incomplete. A skipped owner, note, or custom-field step never counts as a failed contact delivery. Destination state uses the destination as saved now. A destination edited after a lead settled can read differently than it did at delivery time. `workflowNameFromContract` is a code constant for the VET webform contract, not a live GoHighLevel read.

### Infrastructure

Postgres and Valkey round trip, per-queue counts, oldest waiting job, stalled candidates, and the latest completed drain job per scheduled queue. The worker writes no heartbeat of its own, so worker liveness is inferred and labelled `basis`. The API's environment flags decide which drains are expected, and the worker's environment can differ.

## What is never returned

Stored request or response bodies, lead names, emails, phones, addresses, spreadsheet row values, GHL tokens, Google tokens, and portal credentials. Error text is scrubbed and capped. Quoted values become `[redacted]`, and any text with an unrecognised capitalised word or a run of four or more digits (a name, a street number, a ZIP) is returned as `[withheld]`; use `errorCode` and `httpStatus` instead. GHL error bodies are reduced to `statusCode`, `error`, and a scrubbed `message`. The response carries `evidence: { storedBodiesReturned: false, consumerFieldsReturned: false, externalCallsMade: false }` on a run.

## Safety properties

- Every database read runs in one transaction that the server marks `READ ONLY`, with `statement_timeout` 8 s, `lock_timeout` 1 s, and `idle_in_transaction_session_timeout` 30 s as `SET LOCAL`. A write, DDL, or `SELECT ... FOR UPDATE` raises on the server.
- Queue reads use BullMQ handles with `skipMetasUpdate` and call count, list, and set-cardinality reads only. Every Valkey wait has a 2.5 s deadline.
- Per-section evaluation is capped (500 outbox rows, 500 succeeded Sheets jobs, 50 run-index rows per page). A capped section sets `truncated` and adds a `ghl_evaluation_truncated` or `sheets_receipts_truncated` attention entry. A truncated GHL section still reports the full window count in `intendedDeliveries`.
- Limits: 30 requests per minute per client IP and at most 2 concurrent diagnostics per API process. State is per process.
- Each section reads in its own transaction. A section that times out returns `available: false` and the others still return.
- Audit: each authenticated request logs `delivery_diagnostics.access` (route, outcome, request id, IP, duration, validated filters). A rejected key logs `delivery_diagnostics.auth_denied`. The key is never logged.
- Responses send `cache-control: no-store`.

## Known limits

- No DB audit table exists. Audit is the structured log only.
- The rate limiter is per process, and unauthenticated attempts are not rate limited here.
- The outbox and Sheets job tables have no index on the window columns alone. Filtering by `clientAccountId` uses the existing client indexes where they exist. A 7-day, unfiltered call on a large table relies on the 8 s statement timeout and the row caps. Index additions belong to the Auth/Account lane.
- Campaign filtering resolves at most 2000 intake events for the window and sets `leadIdsCapped` when it reaches the cap.

## Tests

- `delivery-diagnostics.unit.test.ts`: windows, cursors, sanitizers, classification, limits.
- `delivery-diagnostics.guard.test.ts`: source guard against writes, queue mutation, network calls, executor imports, and payload columns.
- `admin-delivery-diagnostics.routes.test.ts`: auth, GET-only routing, validation, limits, stable errors.
- `delivery-diagnostics.integration.test.ts`: local Postgres and Redis. Server-side write rejection, classification of seeded incident-shaped rows, no PII in any response, table counts and Redis keys unchanged, no network call, and the CLI end to end.
