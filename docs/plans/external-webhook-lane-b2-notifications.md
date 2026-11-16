# External webhook notices — Lane B2

Storage and eligibility only. This document does not send SMS or email, enable `SA360_SMS_NOTIFICATIONS_ENABLED` or `SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED`, mount `scanCanonicalDeliveryNotifications`, or add a GET retrieval API.

`origin/master` already contains #337 (`1b92098f`, destination and attempt foundation) and #335 (`8ab3dd14`, disabled Twilio adapter and the B1 planner).

## Schema

`ClientDeliveryNotificationChannel` stays `email`. A1 already stores `recipientPhoneE164`, `recipientPhoneVerifiedAt`, and `smsEnabled`. Those are not consent. This migration adds:

| Column | Meaning |
| --- | --- |
| `smsConsentVersion` | `external-webhook-sms-v1` or null |
| `smsConsentText` | The canonical consent sentence, or null |
| `smsConsentRecordedAt` | Transaction time of that consent |
| `smsEnabledAt` / `smsDisabledAt` | SMS on/off clock, independent of email `enabledAt` |
| `smsSuppressionState` | `unknown` (default), `clear`, or `suppressed` |
| `smsSuppressedAt` | STOP or Twilio 21610 time |

`smsEnabled` true is rejected unless the phone is verified, the canonical consent is present, `smsEnabledAt` is set, and suppression is `clear`. Unknown and suppressed force `smsEnabled` false. A verified phone, an email opt-in, and account creation do not satisfy the check.

`ExternalWebhookDeliveryAttempt.httpAcceptedAt` is null until a trigger stamps `transaction_timestamp()` the first time `outcome` becomes `http_accepted`. Later updates do not move it. The sender's outcome, payload, and idempotency key are unchanged. The column is the acceptance time because A1 does not store one.

`ExternalWebhookNotificationReceipt` is one row per `external_webhook:{acceptanceId}:{channel}:{recipient}`. `acceptanceId` is the attempt id. The row has no lead payload and no raw provider body.

## Idempotency

The key matches the B1 planner: acceptance id, channel (`email` or `sms`), and the normalized operator recipient.

A replay, a second claim, and a second inspection of the same attempt return the same row. Email and SMS are different keys. A Sheets delivery for the same lead is not part of the key and does not create another notice. `DeliverySuccessNotification` remains one email per client and source lead. This table does not write it.

`uncertain` and `provider_accepted` are not claimed again. A restarted worker cannot place a second provider call for that key.

## State transitions

| From | To |
| --- | --- |
| `pending` | `sending`, `suppressed` |
| `sending` | `provider_accepted`, `failed`, `uncertain`, `suppressed` |
| `provider_accepted` | `sent`, `failed`, `suppressed` |
| `uncertain` | `provider_accepted`, `failed`, `suppressed` |
| `sent`, `failed`, `suppressed` | none |

`provider_accepted` means Twilio or Resend accepted the create call. `sent` requires `deliveryEvidence`, which is set only for provider statuses `delivered` or `read`. Status `accepted` or `queued` stays `provider_accepted`.

## Consent and STOP

Record the phone, then record the exact consent text and version, then enable SMS. Each step is separate. Suppression defaults to `unknown`, and unknown does not insert a sendable receipt.

Local STOP sets `suppressed`, turns SMS off, and moves pending SMS receipts to `suppressed`. It does not clear because a phone number was re-saved. Replacing a suppressed number is refused. A new consent is refused while suppressed.

Twilio error 21610 on a claimed receipt sets the same suppression and `skipReason` `provider_21610`.

LAL's Messaging Service must have Advanced Opt-Out enabled in Twilio before any later activation, so STOP, START, and HELP are handled on the carrier path. This repository does not call Twilio to turn that on.

## Provider callback wiring, later

The B1 adapter does not set `StatusCallback`. Recipient delivery confirmation does not exist yet.

A later dispatcher, not this PR, must:

1. Refuse to call Twilio or Resend unless the process flag or Resend configuration allows it, and only for a row this module moved to `sending`.
2. On HTTP 201 with a Message `sid`, call `markExternalWebhookNoticeProviderAccepted`. Do not call `markExternalWebhookNoticeDeliveryConfirmed`.
3. On a thrown request, call `markExternalWebhookNoticeUncertain` and do not retry that key.
4. Register `StatusCallback` only on that later send. The URL must verify `X-Twilio-Signature` with the auth token before trusting `MessageSid`, `MessageStatus`, or `ErrorCode`.
5. Map `delivered` and `read` through `markExternalWebhookNoticeDeliveryConfirmed`. Map `21610` through `markExternalWebhookNoticeProviderStop`. Store the numeric code and the allowlisted status word. Do not store the callback body, the lead, or the message text.
6. Keep email on `sendTransactionalEmail`. Resend's id is `provider_accepted`. An inbox delivery webhook is a separate later confirmation, using the same `sent` transition.

## Acceptance assumptions

An eligible event is an `ExternalWebhookDeliveryAttempt` with `outcome = http_accepted`, HTTP 200–299, `requestLeftSa360`, and `httpAcceptedAt`. That attempt id is the B1 `acceptanceId` and the B1 `attemptId`. A1 allows one attempt per client and source lead, so a second 2xx for the same lead is not a second acceptance until A2's sender model says otherwise. `acceptedAt` must be strictly after email `enabledAt`, or strictly after the later of SMS consent and `smsEnabledAt`.

Notices do not change the attempt outcome.

## Admin operations for a future Team Workspace screen

No route or page is added. The later screen calls the functions in this PR:

| Operation | Function | Effect |
| --- | --- | --- |
| Set the SMS number | `recordNotificationPhone` | Verifies E.164. Does not consent. Refuses to replace a suppressed number. |
| Record SMS consent | `recordSmsConsent` | Stores the canonical text, version, and timestamp. Leaves SMS off. |
| Enable or disable SMS | `setSmsNotificationEnabled` | Independent of the email checkbox. Enable fails closed on unknown or STOP. |
| Enable or disable email | existing `setDeliveryNotificationEnabled` | Unchanged. |
| View notice status | read `ExternalWebhookNotificationReceipt` | Status, provider id, safe code. No lead payload and no provider body. |

## GO / NO-GO

GO for review of consent, receipts, and transitions. NO-GO for a live dispatcher, flag changes, and deployment. The dispatcher must claim with the process flag still defaulting off, then perform the callback wiring above.
