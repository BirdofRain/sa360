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

`EXTERNAL_WEBHOOK_NOTICE_QUEUE` has one BullMQ worker that calls `processExternalWebhookNoticeJob`. Flag off returns before HTTP. The repeatable job name is `discover-external-webhook-notices` and its id is `external-webhook-notice-discover`. A second worker start leaves that one job. Changing the interval removes the previous repeatable key and keeps the new one. Flag off removes only those discovery repeatables. Other repeatable names on the queue stay. The default interval is 60 seconds. `SA360_EXTERNAL_WEBHOOK_NOTICE_DISCOVER_INTERVAL_SECONDS` may be 15 through 3600. It is unset.

Sheets, GHL, and external-webhook delivery workers are unchanged. `scanCanonicalDeliveryNotifications` is not mounted.

## Pending receipt recovery

Each enabled discovery pass re-queues one page of `pending` receipts. The page is a keyset on `(createdAt, id)` and the cursor advances, so a page that stays pending cannot hide a later receipt. After the last row the cursor wraps. The job id is the receipt id, so a second enqueue does not add a second job. The claim allows one send. `provider_accepted`, `uncertain`, `sent`, `failed`, and `suppressed` are not re-queued. A `sending` row older than 10 minutes becomes `uncertain` and is not resent. A failed enqueue leaves the receipt pending and does not move the cursor past it.

## Database role

Complete transaction visibility is proven only when this session can read `xact_start` for a backend running as a different role. Reading `pg_roles`, or seeing another session of the same role, is not proof. This code does not grant `pg_monitor` or `pg_read_all_stats`. Production discovery leaves visibility unproven and does not delete an ineligible decision because of `pg_stat_activity`.

Those decisions stay in a fair rotation on `(revisitAfter, id)`. Each pass rechecks one page and moves the checked rows to the back. A preference committed later, including by another database role, is still judged on `httpAcceptedAt`. There is no timeout that drops it. Opt-in that starts after `httpAcceptedAt` does not become a pending notice. The snapshot shortcut runs only when visibility was proven. Nothing in this process proves it.

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
