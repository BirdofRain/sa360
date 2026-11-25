# Delivery diagnostics: architecture, access limits, and monitor extension plan

Scope: secure production observability for delivery. Nothing here changes the GHL delivery executor, opportunity creation, retry logic, workflow enrollment, or client configuration, and nothing enables a monitor. The operating guide is `docs/runbooks/delivery-diagnostics.md`.

## 1. Existing diagnostic capabilities (reuse first)

| Capability | Where | Reuse decision |
| --- | --- | --- |
| Delivery-health monitor engine (Sheets only) | `services/delivery-health/{config,rules,scan,evidence}.ts`, worker queue `delivery-health-monitor` | Reused as-is. Its snapshot loader now accepts a transaction client (type-only change) so the summary can show a `monitorPreview` |
| Canonical delivery predicates | `services/delivery-success/canonical-delivery.ts` (`canonicalGhlDelivery`, `ghlContactReceived`, `canonicalCompanySheetsDelivery`, `separateDeliveryResults`, `deliveryRetryDisposition`) | Reused. Diagnostics never re-derive success |
| Portal GHL facts loaders | `services/lead-delivery/portal-ghl-delivery.ts` | Reused. `loadOnboardingKeys` and `loadAttemptIds` are exported and accept a transaction client |
| Admin run detail | `routes/admin-ghl-live-delivery.ts` | Not reused for incident reads. Stored "redacted" bodies still contain consumer fields (`redactWebhookPayloadForLog` strips credentials only). The new run projection returns statuses and sanitized codes only |
| Admin auth | `lib/admin-auth.ts` (`x-sa360-admin-key`, constant-time compare) | Reused |
| Read-only production verifier | `scripts/verify-production-readonly.mjs` | Pattern reused for the CLI. Different scope (public and admin health checks) |
| Outbox ledger | `GhlAssociationDispatchOutbox` | Used as the intended-delivery ledger for GHL |
| Heartbeat and incidents | `DeliveryHealthMonitorHeartbeat`, `DeliveryHealthIncident` | Read for the infrastructure section and the Phase 5 plan |

Gaps found: no admin audit table, no admin rate limit, no worker heartbeat, no queue-depth endpoint, no GHL run listing with sanitized fields, and no index on several window columns.

## 2. Safest method of reading the Jason Newman incident records

The incident rows are in production Postgres. The safest read path is the new admin API with an authorized admin key, called through the CLI from an operator machine:

1. `runs --client <Jason's clientAccountId> --status failed --window 7d` to confirm run `cmwvjeutx00iohn0u95v1d578`.
2. `run cmwvjeutx00iohn0u95v1d578 cmwvktviw00nhhn0uc3ru5eer cmwvy9fwa017lhn0uxyly0cq6`.

Each response answers the requested questions without consumer data: destination client id and GHL location id; contact step status and external id; opportunity step status, sanitized error code, HTTP status, and sanitized GHL message; workflow step status, whether it was attempted, the workflow requirement recorded on the run, and the retry disposition; and the destination configuration (workflow id, trigger mode, start requirement, opportunity creation flag, pipeline and stage, `lalAiBot1VetWebform`, config updated timestamp, and whether it changed after the run). `partial_success` runs list each non-succeeded step in `contributors` with its required or optional effect.

Not used: a database console, a public database port, or an ad hoc SQL session. None is needed.

## 3. Production access limitations (verified and inaccessible)

Verified from outside the application, without credentials:

- Public health endpoints return 200 and the API reports build `b2fcd03`.
- Admin endpoints return 401 without a key.
- The App Platform spec stores secrets encrypted.

Inaccessible in this session, because no admin key and no production database credential was provided and none may be used:

- The step rows, destination configuration, and run details for the three incident runs.
- The 24 h and 7 d reconciliation counts.
- Production queue depth and worker state.

Nothing in this change was run against production. Reconciliation against a source-side total is not possible from SA360 data alone, because no source reports its own totals into SA360.

## 4. Diagnostic architecture

```
operator CLI / curl  --HTTPS-->  GET /admin/v1/delivery-diagnostics/*
                                   |  verifyAdminApiKey
                                   |  rate limit (30/min/IP), concurrency gate (2)
                                   |  zod validation (named windows, safe ids, caps)
                                   v
                       summary.ts / run-list.ts / ghl-run-diagnostic.ts
                                   |  one READ ONLY transaction per section
                                   v
   intake-health  sheets-health  ghl-health  infra-health (Postgres, Valkey, BullMQ reads)
                                   |
                       canonical predicates (existing)
```

Files: `apps/api/src/services/delivery-diagnostics/*` and `apps/api/src/routes/admin-delivery-diagnostics.ts`. No schema or migration change.

## 5. Query and performance considerations

- Windows: 24 h or 7 d. No free-form range.
- Counts use `groupBy`. Row-level evaluation is capped at 500 outbox rows and 500 succeeded Sheets jobs. Run index pages are at most 50 rows with a keyset cursor on `(startedAt, id)`.
- Indexes in use: `GhlLiveDeliveryRun(destinationClientAccountId, startedAt)` and `(status, startedAt)`, `GhlAssociationDispatchOutbox(status, availableAt)` and `(sourceLeadEventId)`, `CompanySheetsDeliveryJob(status, updatedAt)` and `(clientAccountId, createdAt)`, `CompanySheetsDispatchIntent(status, availableAt)`, `SourceLeadEvent(receivedAt)`, `(sourceProvider, sourceCampaignId)`, `(clientAccountIdResolved)`, `WebhookRequestLog(receivedAt)`, `(source, receivedAt)`.
- Without a supporting index: outbox `availableAt` alone or with `clientAccountId`; Sheets jobs `createdAt` alone; Sheets intents `createdAt` with `clientAccountId`. At current table sizes these are bounded by the 8 s statement timeout and the row caps. A follow-up migration (Auth/Account lane) should add `GhlAssociationDispatchOutbox(clientAccountId, availableAt)`, `CompanySheetsDeliveryJob(kind, createdAt)`, and `GhlLiveDeliveryRun(mode, startedAt)` if production plans show sequential scans.
- Timeouts: `statement_timeout` 8 s, `lock_timeout` 1 s, transaction 25 s, Valkey 2.5 s.
- Load: at most 2 concurrent diagnostics per API process. Each section is its own short transaction.

## 6. Security model

- Authentication: existing admin key only. No new unauthenticated endpoint. Client and workspace credentials are rejected.
- Tenant isolation: the admin key is global by design. Filters narrow a view. They are not a boundary.
- Data: no stored bodies, lead fields, spreadsheet values, or credentials. Error text is scrubbed and capped. A source guard test forbids payload columns and write calls in the module.
- No mutation: server-enforced `READ ONLY` transactions; BullMQ handles with `skipMetasUpdate`; no queue, Redis, or provider writes. Tests prove table counts and Redis keys are unchanged and that a write is rejected by Postgres.
- No arbitrary SQL: fixed queries, validated identifiers, no raw string interpolation.
- Abuse: rate limit, concurrency gate, row caps, bounded windows, `cache-control: no-store`.
- Audit: structured access log with request id, IP, route, outcome, and validated filters.
- Network: no firewall exception and no new public database access. The API is already the public surface.
- Residual risks: audit is log-only; the limiter is per process; unauthenticated attempts only log. A DB audit table needs a migration (Auth/Account lane).

## 7. Existing monitor extension plan (not enabled)

The Sheets monitor keeps its engine, incident table, mailer, and heartbeat. GHL extends it as additional rules over the same snapshot pattern. `DeliveryHealthIncident.failureClass` is a free string, so no migration is needed. `persistScan` already provides one open incident per `(clientAccountId, failureClass)`, escalation, cooldown, reminder, and recovery notices.

Proposed GHL failure classes, each from `classifyGhlDelivery` over the outbox ledger:

| Class | Trigger | Severity | Notes |
| --- | --- | --- | --- |
| `ghl_required_step_failed` | `terminal_required_step_failure` | critical immediately | Includes opportunity when the destination expects it. Names the step and HTTP status |
| `ghl_required_workflow_incomplete` | `contact_delivered_required_workflow_incomplete` | critical immediately | Contact is in GHL. The required workflow did not enroll |
| `ghl_contact_unverified` | `contact_not_verified`, `settled_without_run_unexplained` | critical immediately | Missing receipt evidence |
| `ghl_pending_stale` | `pending_overdue` | warning at 5 min, critical at 15 | Drain not running or blocked |
| `ghl_uncertain_hold` | `held_uncertain`, `held_stale_executing` | critical immediately | Never retried automatically |
| `routing_dispatch_missing` | Confirmed routing to a live destination with no outbox row | warning at 2 min, critical at 15 | Mirrors Sheets `missing_dispatch` |
| `worker_drain_stale` | Latest completed drain older than `staleMs` while the flag is on | critical | From queue state or a real worker heartbeat |
| `queue_stalled` | Stalled candidates above zero for N scans | warning | |

Never paged: `intentional_non_delivery` (shadow, disabled, not approved, inventory or review holds), `duplicate_skipped`, `delivered_optional_warnings`, and a skipped owner, note, or field step. Those stay visible in diagnostics only. An unrecorded workflow requirement pages only as `info` in the summary, and never as a failure.

Dedup, cooldown, and recovery reuse the existing mechanics: one open incident per client and class, notify on open, escalate on severity change, remind after the cooldown, and send recovery when a later canonical receipt or a settled state clears the subject. A destination that goes paused or non-live suppresses delay classes, as the Sheets rules already do for paused clients.

Gates before enabling anything: evaluate on a pilot client list in dry run (`SA360_DELIVERY_HEALTH_NOTIFY_ENABLED` unset), compare findings with the diagnostics summary for the same window, then enable notify for one client. No monitor flag changes in this phase.

## 8. Recommended implementation sequence

1. Merge this read-only diagnostics PR and run `run <id>` for the three incident runs with an authorized key. That closes the evidence gap.
2. Add the worker heartbeat (a row or Valkey key written by the worker) so worker liveness stops being inferred. Worker or Auth lane.
3. Add the DB audit table and the indexes in section 5 (Auth/Account lane migration).
4. Add GHL rules to the monitor engine behind the existing pilot list, dry run only.
5. Compare dry-run findings with the diagnostics summary for one week, then enable notifications for one pilot client.
6. Add independent source totals (LeadCapture, Zapier, Meta exports) as a separate reconciliation input before claiming source coverage.
