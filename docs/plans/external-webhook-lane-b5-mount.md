# External webhook notice mount — Lane B5

The callback routes, the admin drain, the notice worker, and the discovery schedule are registered. Nothing sends unless the process flag is the exact string `true`. This document does not set that flag and does not call Twilio or Resend.

## Registered routes

- `POST /admin/v1/external-webhook-notice/internal/discover`
- `POST /admin/v1/external-webhook-notice/internal/dispatch`
- `POST /integrations/twilio/external-webhook-notice/status`
- `POST /integrations/twilio/external-webhook-notice/inbound`

The admin routes require `x-sa360-admin-key`. A missing key is 401, or 503 when no admin key is configured. With the dispatch flag off, a valid key returns `{ skipped: "flag_off" }` and does not discover, recover, or send.

The Twilio routes parse `application/x-www-form-urlencoded` only in their own plugin when that context does not already have a parser. Signature checks use the configured public URL, not the internal request host. An invalid signature is 403 and writes nothing.

## Worker and schedule

`EXTERNAL_WEBHOOK_NOTICE_QUEUE` has one BullMQ worker that calls `processExternalWebhookNoticeJob`. Flag off returns before HTTP. The repeatable job name is `discover-external-webhook-notices` and its id is `external-webhook-notice-discover`. A second worker start updates that same job. Flag off removes it. The default interval is 60 seconds. `SA360_EXTERNAL_WEBHOOK_NOTICE_DISCOVER_INTERVAL_SECONDS` may be 15 through 3600. It is unset.

Sheets, GHL, and external-webhook delivery workers are unchanged. `scanCanonicalDeliveryNotifications` is not mounted.

## Pending receipt recovery

Each enabled discovery pass re-queues `pending` receipts, oldest first, one page at a time. A receipt whose queue job was lost is found without scanning its acceptance again. The job id is the receipt id, so a second enqueue does not add a second job. The claim allows one send. `provider_accepted`, `uncertain`, `sent`, `failed`, and `suppressed` are not re-queued. A `sending` row older than 10 minutes becomes `uncertain` and is not resent.

## Database role

Decision reopen reads `pg_stat_activity` for sessions this role can already see. An application role sees its own other sessions, so its preference and acceptance transactions are visible without `pg_monitor` or `pg_read_all_stats`. This code does not grant those roles. If that catalog read fails, ineligible decisions are rechecked for 15 minutes and then left in place. A transaction owned by a different database role can remain invisible, and an eligible acceptance can stay blocked for that channel after the decision is stable. Opt-in that starts after `httpAcceptedAt` still does not send.

## Twilio configuration is not assumed

`StatusCallback` is added to the outbound Messages POST only when `SA360_TWILIO_STATUS_CALLBACK_URL` is a validated public HTTPS URL. The signature is computed over that exact URL plus the form fields. An account-level or Messaging Service opt-out webhook is a separate Twilio setting. STOP reaches this API only when Twilio posts to `/integrations/twilio/external-webhook-notice/inbound` and `SA360_TWILIO_INBOUND_CALLBACK_URL` is that same public URL. `SA360_SMS_INBOUND_OPT_OUT_ENABLED` must also be exact `true` before STOP is stored. START does not clear a stored STOP.

## Future canary values

Set these only on the API and worker processes that should send. Do not set them in this change.

- `SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED=true` on the API and the worker
- `ADMIN_API_KEY` on the API and the worker
- `SA360_API_INTERNAL_URL` on the worker, when the API is not `http://127.0.0.1:3001`
- Resend configured for email
- `SA360_SMS_NOTIFICATIONS_ENABLED=true` only if SMS should send
- `SA360_TWILIO_ACCOUNT_SID`, `SA360_TWILIO_AUTH_TOKEN`, `SA360_TWILIO_MESSAGING_SERVICE_SID`
- `SA360_TWILIO_STATUS_CALLBACK_URL=https://<public-host>/integrations/twilio/external-webhook-notice/status`
- `SA360_TWILIO_INBOUND_CALLBACK_URL=https://<public-host>/integrations/twilio/external-webhook-notice/inbound`
- `SA360_SMS_INBOUND_OPT_OUT_ENABLED=true` only if inbound STOP should be stored
- Optional `SA360_EXTERNAL_WEBHOOK_NOTICE_DISCOVER_INTERVAL_SECONDS`

Point the Twilio Messaging Service status callback and the inbound or opt-out webhook at those two public URLs. Do not point them at an admin or internal host.
