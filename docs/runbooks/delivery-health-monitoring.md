# Delivery health monitoring — phase 1

Read-only monitor for confirmed Google Sheets campaign-lead delivery problems.
It writes `DeliveryHealthIncident` and `DeliveryHealthMonitorHeartbeat` only.
It does not change routing, delivery flags, source leads, Sheets jobs, published maps, or Google data.
It does not retry an append, including an uncertain append.

Sheets success is the existing canonical receipt: job status `succeeded`, `finishedAt` set, and written `CompanySheetsDeliveryRow` rows, with the campaign dispatch intent. An HTTP 200, on a webhook or on a Google response, is not a receipt.

Notifications stay off until the checklist below is complete. Both flags must be the exact string `true`.

## What it pages

Pilot membership is `SA360_DELIVERY_HEALTH_PILOT_CLIENT_IDS`: comma-separated `clientAccountId` values. A display name is rejected and is not logged.

| Condition | Class | Severity |
| --- | --- | --- |
| Job or intent code is `unauthorized`, `google_reconnect_required`, or `google_not_connected` | `google_authorization` | critical immediately |
| Job or intent code is `access_denied` or `insufficient_capability` | `google_permission` | critical immediately |
| Job or intent code is a terminal configuration code and the intent is not an expected hold | `google_configuration` | critical immediately |
| Job status `uncertain`, or `uncertainReason` is set, and no later canonical receipt exists for that lead | `uncertain_append` | critical immediately |
| Job status `succeeded` but the canonical receipt fails, and no later canonical receipt exists for that lead | `sheets_receipt_unverified` | critical immediately |
| Routed, eligible lead with no campaign dispatch intent | `missing_dispatch` | warning at 2 minutes, critical at 15 |
| Dispatch or retryable job with no canonical receipt | `sheets_receipt_delayed` | warning at 5 minutes, critical at 15 |
| Webhook audit `stored` or `captured` with HTTP 2xx, plus a matched `RoutingDryRunDecision`, and no `SourceLeadEvent` | `missing_intake` | warning at 2 minutes, critical at 15 |

One open incident exists per client account and failure class. `affectedCount` is the number of subjects. A repeat scan updates `lastSeenAt` and does not insert a second open row.

A later canonical receipt for the same lead clears an older failed, uncertain, or unverified job. A newer uncertain append, permission failure, or unverified success still pages. The monitor does not replay either job.

An open `missing_intake` incident is reloaded by its routing decision id and webhook id after those rows age out of the lookback. The incident stays open until a later scan sees the source event, or the client is paused or campaign dispatch is disabled. Leaving the lookback window is not recovery.

Stored evidence keeps every subject id for that incident. The email lists at most 10. `affectedCount` is the full count. A lead that is still failing is reloaded after the lookback even when more than 20 leads share the incident. Error text stored on the heartbeat is scrubbed of email addresses and phone numbers before it is saved or mailed.

The runtime role `sa360_app` receives `SELECT`, `INSERT`, and `UPDATE` on `DeliveryHealthIncident` and `DeliveryHealthMonitorHeartbeat` from `20261120190000_delivery_health_sa360_app_grants`. That migration does not grant `DELETE`, does not grant to `PUBLIC`, and does not create the role. On a non-loopback database the migration fails if `sa360_app` is absent. Loopback databases skip the grant until the role exists.

## What it keeps quiet

- Expected holds: `awaiting_setup`, `needs_explicit_schedule`, `duplicate_held`, `review_held`, `assessment_held`, `assessment_failed`, and duplicate person-gate codes.
- Paused, onboarding, or archived clients, and destinations with campaign dispatch disabled or no cutoff. These suppress delay and missing-intake pages. A permissions failure or uncertain append on an existing job still pages, because that write already happened.
- Test jobs (`canary`, `campaign_test`, `onboarding_captured_test`) and internal Sheets pilot leads.
- A pilot with no routed leads and no corroborated intake. An empty webhook log is not missing intake.
- Leads routed before `campaignDispatchNotBefore`.

Aged-release jobs are outside this phase.

## Notices

Mail uses `sendTransactionalEmail` (Resend). Recipients are `SA360_DELIVERY_HEALTH_NOTIFY_RECIPIENTS`. The body contains the client account id, failure class, counts, timestamps, and internal ids. It does not contain lead payloads, email addresses, or phone numbers.

- The first open notice uses idempotency key `dh:{incidentId}:opened:{severity}`.
- Warning to critical uses `dh:{incidentId}:escalated:critical` and ignores the cooldown.
- A later reminder waits for `SA360_DELIVERY_HEALTH_NOTIFY_COOLDOWN_SECONDS` (default 3600, allowed 60–86400).
- Recovery uses `dh:{incidentId}:recovered` after a notice was sent and the condition clears.
- An acknowledged incident (`acknowledgedAt` set) skips reminders. Escalation and recovery still send. Phase 1 has no acknowledge route; set the column only in a reviewed database session.

`lastNotificationKey`, `lastNotificationKind`, `lastNotifiedSeverity`, and `lastNotifiedAt` change together, and only after Resend accepts that message. A failed opening, escalation, or recovery leaves the last accepted notice in place and retries the same idempotency key. A failed recovery does not resolve the incident. A dry run with notifications off still resolves a cleared condition without sending mail.

The scanner heartbeat is `DeliveryHealthMonitorHeartbeat` id `delivery_health_sheets`. A thrown scan still updates `lastFailedAt` and `consecutiveFailures` when the incident write did not run. The monitor notice is separate from delivery incidents. Keys are `dh-monitor:scanner_failed:{bucket}`, `dh-monitor:heartbeat_stale:{bucket}`, and `dh-monitor:recovered:{failure timestamp}`.

`lastMonitorNotificationKey` and `lastMonitorNotifiedAt` are written together, and only after Resend accepts that key. A newer notice that fails to send leaves the previous accepted key in place. The old timestamp is not proof that the new key was sent, so the next scan retries the unsent key. Recovery keeps being offered until the recovered key itself is accepted.

A dead worker does not run this check. After the monitor is enabled, an operator can alarm on `lastSucceededAt` from outside the process. The stale window is `SA360_DELIVERY_HEALTH_HEARTBEAT_STALE_SECONDS` (default 300). `consecutiveFailures` and `lastFailedAt` move when the API records a failed scan, including an enabled monitor whose pilot list is empty (`pilot_unconfigured`).

With the worker flag on, a missing `ADMIN_API_KEY`, an API body of `skipped: "flag_off"`, or a body that did not query a pilot fails the BullMQ job. HTTP 200 alone is not a healthy scan. The worker flag itself off still returns before any HTTP call, and the schedule sync removes the repeat. A missing admin key or an API flag mismatch does not write a new heartbeat success, so `lastSucceededAt` stops advancing.

## Configuration

Set these on the API process that serves `/admin/v1/delivery-health/internal/scan` and on the worker that schedules it. Do not put secret values in the repository.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SA360_DELIVERY_HEALTH_MONITOR_ENABLED` | off | Exact `true` registers the worker repeat and allows the scan route. |
| `SA360_DELIVERY_HEALTH_NOTIFY_ENABLED` | off | Exact `true` allows Resend. Off is a dry run: incidents are written, mail is not. |
| `SA360_DELIVERY_HEALTH_PILOT_CLIENT_IDS` | empty | `clientAccountId` list. With the monitor flag on, an empty list fails the scan and records `pilot_unconfigured`. |
| `SA360_DELIVERY_HEALTH_NOTIFY_RECIPIENTS` | empty | Internal inbox list. Required before notify can send. |
| `SA360_DELIVERY_HEALTH_MONITOR_INTERVAL_SECONDS` | 60 | Worker repeat. Allowed 15–3600. |
| `SA360_DELIVERY_HEALTH_LOOKBACK_HOURS` | 48 | Allowed 1–168. Open incident subjects are reloaded after they age out of this window. |
| `RESEND_API_KEY` | unset | Existing mail secret. Required only when notify is on. |
| `SA360_TRANSACTIONAL_EMAIL_FROM` | unset | Existing from-address. Required only when notify is on. |
| `ADMIN_API_KEY` | existing | Worker credential for the internal route. |
| `SA360_API_INTERNAL_URL` | `http://127.0.0.1:3001` | API base for the worker POST. |

The route is `POST /admin/v1/delivery-health/internal/scan` with `x-sa360-admin-key`. The JSON body is `{}`. The response contains counts and failure class names.

## Pilot activation — Ray Rodriguez

Do this only after the migration is applied and this change is the reviewed build. Do not enable notify in the same step as the first scan.

1. Look up the account: `ClientAccount.clientAccountId` where the operator recognizes the Ray Rodriguez account. Copy that id. Do not put the display name in configuration.
2. Confirm the account status is `active` and `CompanySheetsDestination.campaignDispatchEnabled` is true with `campaignDispatchNotBefore` set. If either is false, delay pages stay quiet on purpose.
3. Set `SA360_DELIVERY_HEALTH_PILOT_CLIENT_IDS` to that single id.
4. Set `SA360_DELIVERY_HEALTH_NOTIFY_RECIPIENTS` to the internal inboxes that will review the dry run. Leave `SA360_DELIVERY_HEALTH_NOTIFY_ENABLED` unset.
5. Set `SA360_DELIVERY_HEALTH_MONITOR_ENABLED=true` on the API and the worker only after the pilot id is present. An empty list records heartbeat failure `pilot_unconfigured` and the worker job fails. Restart the worker so it upserts one repeatable job named `scan-delivery-health`.
6. Call the internal scan once, or wait for the worker tick. Expect `dryRun: true` and `notificationSkipped: "notify_disabled"`.
7. Read `DeliveryHealthIncident` for that client account. Confirm `evidenceJson` has ids and machine codes only. Confirm no `SourceLeadEvent`, `CompanySheetsDeliveryJob`, `CompanySheetsDispatchIntent`, or destination row changed. Confirm the API log line `delivery_health.scan` has counts only.
8. Compare any open class with the delivery job screen before treating it as a customer-facing outage. `uncertain_append` means the append outcome is unknown. Leave reconciliation to the existing Sheets writer. Do not replay the job by hand from this monitor.
9. After that review, set `SA360_DELIVERY_HEALTH_NOTIFY_ENABLED=true` and confirm `RESEND_API_KEY` and `SA360_TRANSACTIONAL_EMAIL_FROM` are already present. Send no test message that includes a lead payload.
10. Watch `DeliveryHealthMonitorHeartbeat.lastSucceededAt` advance. A scan failure increments `consecutiveFailures` and, with notify on, sends the monitor notice.

## Rollout checklist

- [ ] Migration `20261120140000_delivery_health_monitoring` applied to the target database by the normal migrate path. This change does not run production migrate.
- [ ] `DeliveryHealthIncident_open_client_class_key` exists (partial unique index). Do not drop it in a later Prisma diff.
- [ ] Pilot value is a `clientAccountId`, not a person or company name.
- [ ] Monitor flag reviewed. Notify flag still unset for the first scans.
- [ ] Dry-run response saved: `dryRun`, `queried: true`, `pilotClients` at least 1, `findings`, `failureClasses`, and `heartbeat` other than `failed`. HTTP 200 with `skipped: "flag_off"` or `pilotClients: 0` is a configuration failure.
- [ ] Incident evidence reviewed for ids and codes only.
- [ ] Delivery rows, routing rows, and Google sheets confirmed unchanged by the scan.
- [ ] Recipient list reviewed by the operator who will receive mail.
- [ ] Resend from-address is the existing transactional sender.
- [ ] Notify flag enabled only after the dry run.
- [ ] Heartbeat `lastSucceededAt` is moving.
- [ ] Rollback is unsetting both flags and restarting the worker. The repeatable job is removed. Incident rows stay for audit. Delivery behavior does not change.

## Rollback

Unset `SA360_DELIVERY_HEALTH_MONITOR_ENABLED` and `SA360_DELIVERY_HEALTH_NOTIFY_ENABLED`. Restart the worker. The schedule sync removes the repeatable scan. The internal route returns `skipped: "flag_off"` without querying delivery tables. Existing incident and heartbeat rows remain. No delivery flag is turned off by this rollback because this monitor never turned one on.
