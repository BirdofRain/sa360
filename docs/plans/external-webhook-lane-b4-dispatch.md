# External webhook notice dispatch — Lane B4

Dispatch only. An HTTP 2xx remains endpoint acceptance. This document does not turn on flags, call Twilio or Resend, or mount the legacy delivery-success scanner.

## Architecture

`discoverExternalWebhookNotices` pages `ExternalWebhookDeliveryAttempt` rows that are `attempted`, `http_accepted`, `requestLeftSa360`, HTTP 200–299, and have `httpAcceptedAt`. The page is ordered by `httpAcceptedAt`, `id` and uses `ExternalWebhookDeliveryAttempt_accepted_page_idx`. A single `ExternalWebhookNoticeDiscoveryCursor` row advances only through acceptances at least 30 seconds old, so a late commit is still seen on the next pass. `recordEligibleExternalWebhookNotice` stays idempotent, so a replay does not create a second receipt.

Pending receipts are enqueued on `external-webhook-notice`, one job id per receipt. The worker claims with `claimExternalWebhookNotice` before any provider call. `provider_accepted`, `uncertain`, and `sent` are not claimed again. A `sending` row older than 10 minutes is promoted to `uncertain` and is not resent.

Email uses `sendTransactionalEmail` and `EXTERNAL_WEBHOOK_EMAIL_TEMPLATES.delivery_accepted`. A Resend id is stored as `provider_accepted`. There is no inbox-delivery callback, so the row is not marked `sent`.

SMS uses the B1 Twilio adapter and the fixed SMS template. It runs only when `SA360_SMS_NOTIFICATIONS_ENABLED` is exact `true`, plus the B2 consent, clock, clear suppression, and Twilio config checks. HTTP 201 is `provider_accepted`. The Message `sid` is stored. The body is not logged.

`SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED` must be exact `true` before discovery or dispatch. It is unset. `SA360_SMS_NOTIFICATIONS_ENABLED` stays unset.

## Callbacks are not mounted

`externalWebhookNoticeCallbackRoutes` and `adminExternalWebhookNoticeDispatchRoutes` are not registered in `app.ts`. `processExternalWebhookNoticeJob` is not registered in `worker.ts`. They are not live.

Reviewed follow-up, after A3's route edits have landed:

```ts
await app.register(externalWebhookNoticeCallbackRoutes);
await app.register(adminExternalWebhookNoticeDispatchRoutes, { prefix: "/admin/v1" });
```

And in `apps/worker/src/worker.ts`, a `Worker` on `EXTERNAL_WEBHOOK_NOTICE_QUEUE` that calls `processExternalWebhookNoticeJob`.

Status URL: `SA360_TWILIO_STATUS_CALLBACK_URL`. Inbound URL: `SA360_TWILIO_INBOUND_CALLBACK_URL`. Both signatures use `SA360_TWILIO_AUTH_TOKEN` over the public URL plus the sorted form fields. An invalid signature returns 403 and does not write.

`POST /integrations/twilio/external-webhook-notice/status` updates the receipt with that `MessageSid`. `delivered` and `read` are the only delivery confirmations. A later `queued` callback does not regress `sent`. Error `21610` suppresses SMS.

`POST /integrations/twilio/external-webhook-notice/inbound` is a different request. It does nothing unless `SA360_SMS_INBOUND_OPT_OUT_ENABLED` is exact `true`. STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, and QUIT call `suppressSmsLocally`. START, YES, and UNSTOP are ignored and do not clear a stored STOP.

## Activation blockers

Mount the two plugins and the worker. Set the notice dispatch flag only on the process that should send. Set Resend for email. Set the Twilio account, LAL Messaging Service SID, and exact SMS flag for SMS. Set the two public callback URLs to the mounted routes and enable Advanced Opt-Out in Twilio. Do not treat Resend acceptance as inbox delivery.
