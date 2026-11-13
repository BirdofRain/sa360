# External webhook notifications — Lane B1

Foundation only. This document does not deploy, migrate, toggle a flag, send SMS or email, call Twilio, Resend, GoHighLevel, Make, or any customer webhook, or add a public configuration route.

Lane A owns database migrations, intake, webhook sending, and workers. The types in `apps/api/src/services/external-webhook-notification/` describe the event Lane A must produce. They do not read or write it. Nothing in `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/worker/src/worker.ts`, or the delivery scanner imports that folder.

## What already exists

| Piece | Where | Reuse |
| --- | --- | --- |
| Transactional email | `apps/api/src/lib/transactional-email.ts` | Resend HTTP. No send unless `RESEND_API_KEY` and `SA360_TRANSACTIONAL_EMAIL_FROM` are set. Optional `Idempotency-Key`, sliced to 256 characters. This is the only email provider. |
| Email preference | `ClientDeliveryNotificationPreference` and `normalizeRecipientEmail` | One verified mailbox, channel `email` only. `enabled` defaults false. Off-to-on sets `enabledAt`. A lead is eligible only when completion is strictly after `enabledAt` (`isSourceLeadEligibleForClientNotification`). |
| Claim storage | `DeliverySuccessNotification` | Unique on `(clientAccountId, sourceLeadEventId)`, key `client_lead:{client}:{lead}`. One row per client and source lead. Evidence columns may be filled in later. This row is not the external-webhook notification grain. |
| Scanner | `scanCanonicalDeliveryNotifications` | Not imported by the worker. Runs only when `SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED` is exact `true`. Sends with `sendTransactionalEmail`. |
| Team Workspace | `DeliveryNotificationChoice`, `present.ts` | Read-only webhook host, and an email on/off choice that does not send. |

`ClientDeliveryNotificationChannel` is `email` only. The schema comment says SMS is not a value until a later assignment. This PR does not add that value.

## Twilio configuration

SMS calls stay off unless `SA360_SMS_NOTIFICATIONS_ENABLED` trims to the exact string `true`. Unset, blank, `TRUE`, `1`, `yes`, and `on` stay off. A present Account SID does not enable a call.

| Variable | Required to send, later | Meaning |
| --- | --- | --- |
| `SA360_SMS_NOTIFICATIONS_ENABLED` | Yes, exact `true` | Process kill switch. Default off. Checked before a client is invoked. |
| `SA360_TWILIO_ACCOUNT_SID` | Yes | Twilio Account SID, `AC` plus 32 hex characters. |
| `SA360_TWILIO_AUTH_TOKEN` | Yes | 32 hex characters. Not logged, not placed in the form body, not committed. |
| `SA360_TWILIO_MESSAGING_SERVICE_SID` | Yes | LAL Messaging Service SID, `MG` plus 32 hex characters. Sent as `MessagingServiceSid`. |
| `SA360_TWILIO_SMS_FROM` | No | E.164 sender from that Messaging Service's pool. Empty means Twilio selects the sender. A non-empty invalid value fails closed. |

The adapter posts to `https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json` only when a caller passes both the account config and `fetch`. The prepared notice does not contain the auth token; the client closes over it. There is no default fetch and no `StatusCallback`, so this PR does not register a Twilio webhook. The provider message id is the Message `sid` (`SM...` or `MM...`). Twilio status values map as follows:

| Twilio `status` | Class |
| --- | --- |
| `accepted`, `scheduled`, `queued`, `sending` | pending |
| `sent`, `delivered`, `read` | sent |
| `undelivered`, `failed`, `canceled`, `partially_delivered` | failed |
| `receiving`, `received` | inbound, not an outbound result |
| anything else | unknown |

Provider errors keep the numeric code and a fixed label (`Twilio 400 code 21610`). The response body is not copied, because Twilio error text can echo the destination number. `21610` is `stop_suppressed`. `21211` and `21614` are invalid destinations. `30007` and `30034` are carrier filtering. The SA360 idempotency key is not sent to Twilio. `I-Twilio-Idempotency-Token` on a Twilio webhook is a delivery id, not a create-message dedupe key.

Before any later activation, the LAL Messaging Service needs Advanced Opt-Out turned on in Twilio so STOP, START, and HELP are handled by the carrier path. This repository does not call Twilio to configure that.

## Event Lane A must supply

One notification plan needs one accepted outbound webhook event. Lane A has not shipped this producer. A missing field is not invented.

| Field | Role |
| --- | --- |
| `acceptanceId` | Identifies one HTTP acceptance. A retry of that same acceptance reuses it. A later, distinct 2xx gets a new id. |
| `clientAccountId` | Client the destination belongs to. |
| `sourceLeadEventId` | Lead evidence. Not the idempotency grain. |
| `destinationId` | Destination evidence. Not the idempotency grain. |
| `attemptId` | Attempt evidence. A new attempt id on the same acceptance does not create a second notice. |
| `httpStatus` | Only integers 200 through 299 are `http_accepted`. Anything else is `not_accepted` and is not notified. |
| `acceptedAt` | ISO-8601 time of that acceptance. |

The event must not carry the lead payload, the lead's phone or email, or the destination URL. Those stay in Lane A's stores.

Do not record this event with `recordDeliverySuccessNotification`. That unique key is one email per client and source lead. It collapses channels and recipients, and the scanner below would withhold the client once a custom webhook is armed.

## Idempotency

The key is `external_webhook:{acceptanceId}:{channel}:{recipient}`.

- Channel is `email` or `sms`.
- An email recipient uses the same mailbox rule as `normalizeRecipientEmail`.
- An SMS recipient is E.164.
- The same acceptance, channel, and recipient is one notice, including a retry.
- A second channel or a second recipient is a different key.
- A key longer than 256 characters is rejected. It is not truncated, so two long recipients cannot collapse the way a sliced Resend header could.
- The email plan puts that same key on `SendTransactionalEmailInput.idempotencyKey` for the existing Resend helper. This module does not call Resend.

## Opt-in, STOP, and templates

Email and SMS are independent.

Email uses the existing preference. The plan is a skip unless `preferenceEnabled` is true, the recipient is verified, Resend's two environment variables are set, and `acceptedAt` is strictly after `enabledAt`. The email checkbox does not opt the client into SMS.

SMS requires its own opt-in record: `optedIn` true and a parseable `recordedAt`. There is no table for that record. `acceptedAt` must be strictly after `recordedAt`. `stopState` must be `clear`. `suppressed` and `unknown` both skip, so a missing STOP import cannot send. A later Twilio `21610` is also `stop_suppressed` and must be stored as suppressed before another try. This PR does not receive inbound SMS.

The only SMS body is the fixed `delivery_accepted` template. It is one GSM-7 segment, at most 160 characters, contains `Reply STOP to opt out.`, and has no placeholders. It does not include a lead name, phone, email, address, date of birth, destination URL, or acceptance id. A body with `{`, `}`, `@`, or a digit phone is rejected. The email subject and text for this event are also fixed and contain no lead fields. HTTP acceptance is not described as a completed delivery.

## Legacy scanner predicate

`scanCanonicalDeliveryNotifications` is the canonical successful-delivery scanner. It is not mounted. Do not mount it to announce external-webhook acceptances.

`loadSettings` marks `armed.webhook` when `SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED` is exact `true` and `ClientCustomWebhookDestination.enabled` is true. While that bit is set, `scanOnePage` finishes the client without selecting leads, `decideNotification` returns withhold, and `confirmSend` returns `webhook_armed`. `classifyLead` sets `customWebhookAttemptId` to null, so the scanner also has no webhook receipt. Turning the custom-webhook flag on beside the notification flag would suppress Sheets and GoHighLevel notices for that client and still would not notify the webhook acceptance.

## Team Workspace UX

No new screen or route is added here. The current page stays read-only: a custom webhook shows host, enabled yes or no, and "A target is not a sent delivery." The email choice stays "this page does not send email."

### GoHighLevel Inbound Webhook guided setup

This destination is the URL on a GoHighLevel workflow whose trigger is **Inbound Webhook**. It is not the location API, and it is not `webhook.generic.v1`.

1. Tell the operator the workflow stays in Draft. Saving a URL, once Lane A has a write API, does not arm delivery and does not send a test.
2. The operator copies the URL from that trigger card and pastes it. After a future save, Team Workspace shows the hostname only, matching the host-only custom-webhook line.
3. Checklist, all unanswered until a person checks them: the trigger is Inbound Webhook and no Contact Created, tag, or form trigger shares this workflow; a mapping reference was saved from a sample that contains no consumer lead fields; this client uses either this URL or the location API for one delivery event, not both.
4. Do not show a test-send button. Do not show the full URL again after save.

### Make and other custom webhook URLs

Make is a custom webhook URL, not a separate provider. The operator pastes the HTTPS URL Make (or another receiver) generated. A signing secret, when Lane A stores one, is entered once and never shown again. Display stays host plus enabled, and enabled stays false. Notification idempotency does not gain a Make channel. The destination kind is `custom_webhook`. The notice channel is still email or SMS.

### Sheets, independently

Company Sheets remains its own destination. Enabling Sheets does not require a GoHighLevel URL or a custom webhook URL. Enabling a webhook does not turn Sheets off at the destination layer, and the reverse is also true. The existing campaign-dispatch controls stay the Sheets arm. The UX must not say that a webhook pauses Sheets. The scanner predicate above is the only place those choices are coupled, and that scanner stays unmounted.

### SMS and email preferences

Keep the existing email checkbox and its Admin C.O.C. recipient link. Add a separate SMS row that renders disabled: label "Text a delivery notice", state unavailable, help text "SMS is off. A verified mobile number, an opt-in, and STOP handling have to exist before this can be turned on." Do not collect a phone number in Team Workspace until a schema assignment adds one. Do not reuse the email checkbox for SMS. Both rows state that a notice contains no lead name, phone, or email, and that production delivery is unchanged.

## GET retrieval

HighLevel documents two different GETs. Neither is implemented here.

The support article "Workflow Trigger - Inbound Webhook" (the page's own modified line reads Tue, 8 Apr, 2025 at 4:21 PM, with no zone printed) names the trigger **Inbound Webhook Trigger**. It accepts POST, GET, and PUT **sent to the HighLevel URL**. The setup steps still tell the external app to POST JSON. The changelog "Inbound Webhook Trigger Enhancements" adds GET and PUT to that same URL, and exposes query parameters and headers as custom variables. A GET in this sense is still SA360, or Make, calling GoHighLevel. It does not make GoHighLevel retrieve a lead. Query strings leak into logs and are a poor place for a lead. This is not the retrieval workflow.

The retrieval proposal is the other direction. HighLevel's Custom Webhook article describes an **action**, under Send Data → Custom Webhook. Event `GET` (or Event `CUSTOM` with Method `GET`) calls a URL the workflow names, and the response can be saved for later steps. The article's own FAQ says the action does not require a specific trigger: any trigger can precede it. That answer is about the action. It does not start a run.

For a lead that is not already a contact, Contact Created, Contact Tag Added, and form triggers have nothing to fire on. A schedule trigger is not per lead. The trigger that can start the run from an external delivery system is the **Inbound Webhook Trigger**. The sequence would be: that trigger receives a minimal non-PII ping (the acceptance id only), then a Custom Webhook action with Event GET calls a SA360 URL that does not exist, then later steps map the response onto a contact.

Blockers, all still open:

- No SA360 GET route. This PR does not add one.
- Lane A has not defined `acceptanceId` or a retrieval token.
- The Custom Webhook action would hold a credential inside the customer's workflow.
- The mapping reference has to be captured from a sample response before those fields exist in the builder.
- Building the GET would put lead fields on a URL GoHighLevel stores. That is a separate security review, not a follow-on inside this adapter.
- Enabling the idea by turning on `webhook.generic.v1`, or by mounting the scanner, hits the predicate in the previous section.

## GO / NO-GO

GO for review of this isolated foundation: the Twilio adapter, the fixed templates, the event and idempotency contract, and this note.

NO-GO for activation. Do not set `SA360_SMS_NOTIFICATIONS_ENABLED`, `SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED`, or `SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED`. Do not mount the scanner. Do not add the SMS enum, a GET route, or a Team Workspace write. Do not merge on the assumption that Lane A's acceptance event already exists.
