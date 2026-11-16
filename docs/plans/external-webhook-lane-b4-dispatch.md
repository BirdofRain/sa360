# External webhook notice dispatch — Lane B4

Dispatch only. An HTTP 2xx remains endpoint acceptance. This document does not turn on flags, call Twilio or Resend, or mount the legacy delivery-success scanner.

## Architecture

`discoverExternalWebhookNotices` pages `ExternalWebhookDeliveryAttempt` rows that are `attempted`, `http_accepted`, `requestLeftSa360`, HTTP 200–299, and have `httpAcceptedAt`. The page is a database keyset on `(httpAcceptedAt, id)` and uses `ExternalWebhookDeliveryAttempt_accepted_page_idx`. Rows that share a millisecond stay reachable. The 30 second lag only keeps a just-committed acceptance on a later forward page. It does not cover a transaction whose `httpAcceptedAt` is already behind the cursor. Every run reconciles accepted attempts at or behind the cursor that still lack a receipt and an `ExternalWebhookNoticeChannelDecision` for either channel. An ineligible channel writes one decision. If another database transaction was open, that decision is reopened after the transaction ends so a preference it commits is still judged on `httpAcceptedAt`. A provider that is down writes a pending receipt instead, and the claim refuses to send until Resend or Twilio is ready. The same receipt is not inserted twice. Opt-in after `httpAcceptedAt` does not become a send.

Pending receipts are enqueued on `external-webhook-notice`, one job id per receipt. The worker claims with `claimExternalWebhookNotice` before any provider call. `provider_accepted`, `uncertain`, and `sent` are not claimed again. A `sending` row older than 10 minutes is promoted to `uncertain` and is not resent.

Email uses `sendTransactionalEmail` and `EXTERNAL_WEBHOOK_EMAIL_TEMPLATES.delivery_accepted`. A Resend id is stored as `provider_accepted`. There is no inbox-delivery callback, so the row is not marked `sent`.

SMS uses the B1 Twilio adapter and the fixed SMS template. It runs only when `SA360_SMS_NOTIFICATIONS_ENABLED` is exact `true`, plus the B2 consent, clock, clear suppression, and Twilio config checks. HTTP 201 with `queued` stays `provider_accepted`. The Message `sid` is stored. The body is not logged. `StatusCallback` is added only when `SA360_TWILIO_STATUS_CALLBACK_URL` is HTTPS, has no user, query, or hash, and is not loopback, private, or an `/admin` path. Any other value is omitted.

`SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED` must be exact `true` before discovery or dispatch. It is unset. `SA360_SMS_NOTIFICATIONS_ENABLED` stays unset.

## Mounted, still inactive

`externalWebhookNoticeCallbackRoutes` and `adminExternalWebhookNoticeDispatchRoutes` are registered. The notice worker and its discovery schedule are registered. `SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED` is unset, so discovery, recovery, and provider calls do not run. See `docs/plans/external-webhook-lane-b5-mount.md`.

Status URL: `SA360_TWILIO_STATUS_CALLBACK_URL`. Inbound URL: `SA360_TWILIO_INBOUND_CALLBACK_URL`. Both signatures use `SA360_TWILIO_AUTH_TOKEN` over the public URL plus the sorted form fields. An invalid signature returns 403 and does not write.

`POST /integrations/twilio/external-webhook-notice/status` updates the receipt with that `MessageSid`. `delivered` and `read` are the only delivery confirmations. A later `queued` callback does not regress `sent`. Error `21610` suppresses SMS.

`POST /integrations/twilio/external-webhook-notice/inbound` is a different request. It does nothing unless `SA360_SMS_INBOUND_OPT_OUT_ENABLED` is exact `true`. STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, and QUIT call `suppressSmsPhone`, which suppresses every preference with that E.164. Provider error 21610 does the same. START, YES, and UNSTOP are ignored. Replacing a suppressed number is refused. Neither path clears a stored STOP.

## Activation blockers

The routes and worker are mounted and the flags stay off. Set the notice dispatch flag only on the process that should send. Set Resend for email. Set the Twilio account, LAL Messaging Service SID, and exact SMS flag for SMS. Set the two public callback URLs to the mounted routes. Do not treat Resend acceptance as inbox delivery. The canary values are in `docs/plans/external-webhook-lane-b5-mount.md`.
