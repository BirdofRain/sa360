# T2 toll-free SMS readiness

This is an operator checklist for the SA360 delivery-notification SMS program.
It does not purchase a number, change Twilio, submit toll-free verification, send
an SMS, or turn a feature flag on.

## Number

Life Agent Launch purchased one US toll-free number for this program:
`(888) 409-5462`, E.164 `+18884095462`.

Its Twilio compliance profile is complete. Toll-free verification has not been
submitted. This repository does not store that number in `SA360_TWILIO_SMS_FROM`
and does not call Twilio for it. Do not edit the number or its Twilio
configuration from this change.

The intended Messaging Service name, when an operator creates it later in the
Twilio console, is `SA360 Delivery Notifications`. Do not attach a Synthflow
voice number to that service.

## Consent paths

One row, `ClientDeliveryNotificationPreference`, is the SMS consent record.
`STOP` and Twilio error `21610` still suppress that row. A suppressed row cannot
be enabled.

| Path | What it does | SMS |
| --- | --- | --- |
| One-time link | `GET/POST /public/sms-opt-in/:token`. No portal session. The page checkbox starts unchecked. Consent is recorded only when the recipient submits `affirmDisclosure: true` and both legal URLs are configured. | Turns on only after that submit |
| Verbal note | `POST /admin/v1/team-workspace/clients/:clientAccountId/sms-verbal-consent`. Matt, Alex, or Aaron, identified by a verified staff assertion. A new note stores disclosure version `ghl-lead-sms-v1`, the words, timestamp, operator id, phone, and evidence as `pending_confirmation`. A row that already stores `external-webhook-sms-v2` is not rewritten. | Stays off |
| Link only | `POST /admin/v1/team-workspace/clients/:clientAccountId/sms-opt-in-link`. Same operators. Does not claim a verbal yes. | Stays off until the recipient submits the link |
| Optional portal | `/portal/sms-notifications` and `/client/v1/sms-opt-in`. A signed-in client may use it. It is not required. | New confirmation stores `ghl-lead-sms-v1`. An existing v1 or v2 row stays as recorded |

New opt-in copy is the GoHighLevel lead-received disclosure. The sample message and the NO-GO checklist are in `docs/plans/ghl-lead-sms-notice.md`. Previously recorded `external-webhook-sms-v1` and `external-webhook-sms-v2` rows still authorize only the external-webhook notice. They do not authorize `ghl_lead_received`.

The public page source is `apps/admin-coc/src/app/portal/sms-opt-in/[token]/page.tsx`.
That file is not a published URL. Do not give Twilio a production opt-in URL
until this build is deployed and a reviewer can open the live page.

The confirmation email is sent only when `SA360_SMS_OPT_IN_PUBLIC_ORIGIN` is a
real public `https` origin and transactional email is configured. Otherwise the
API reports `origin_unconfigured` or `email_not_configured` and does not invent
a host. Team Workspace repeats that result. It says the provider accepted the
message only when the provider did, and it does not call that inbox delivery.
The raw token is stored only as a SHA-256 hash.

Confirming a link locks that preference row and writes consent, enablement, and
token consumption in one update. The update matches the token hash and the phone
on the row. A replaced token, a phone change, STOP, or a second submit cannot
confirm a different recipient. The number on the link is staff-supplied.
`smsHandsetProvenAt` is the only independent handset-ownership mark, and the
link does not set it.

A lost response does not prove the write failed. The page says the result
cannot be confirmed and does not submit the token again. A named operator can
read account status without the token. That read does not create a link or
turn SMS on. The optional portal path locks the same row for consent and for
enablement, and it still refuses a suppressed number.

The confirmation page sends `Referrer-Policy: no-referrer` and
`Cache-Control: private, no-store`. Access logs replace the token path segment
with `[redacted]`. The page does not add an analytics tag. Policy links use
`rel="noreferrer"`.

Verbal-only enrollment stays pending until Life Agent Launch's Privacy Policy
and compliance review explicitly allow it. Operator attestation does not call
`recordSmsConsent` and does not set `smsEnabled`.

Inbound `OWN` remains optional handset evidence. It is not required to record
or enable v2 consent. `START` does not clear `STOP`.

## Legal pages

`SA360_SMS_PRIVACY_POLICY_URL` and `SA360_SMS_TERMS_URL` have no default.
Until both are distinct public `https` URLs, the checkbox cannot be submitted
and no v2 consent row is written. This repository does not contain those pages.
Do not create stand-in Privacy Policy or Terms pages here.

The Privacy Policy, when published, needs Twilio's toll-free clause that opt-in
data and consent are not shared with third parties. Match the sentence in
Twilio's current toll-free verification article, including the apostrophe in
"won't".

## What is not verified

These items are assumptions or public list prices, not evidence from this
account's Twilio console or invoice:

- A dedicated Messaging Service does not exist yet.
- SA360 callback URLs are not configured on the purchased number.
- Signed callback acceptance has not been proven against the live host.
- Advanced Opt-Out was not changed. SA360 learns `STOP` from the inbound webhook
  or from error `21610`.
- Public US toll-free lease price read from Twilio's US SMS pricing page was
  `$2.15` per month, and outbound SMS `$0.0083` per segment plus carrier fees.
  Those are list prices, not this account's bill.
- The verification volume to enter, until customer activation is separately
  approved, is `10`.

## Canary

Any of `SA360_SMS_CANARY_ENABLED`, `SA360_SMS_CANARY_CLIENT_ACCOUNT_ID`,
`SA360_SMS_CANARY_ATTEMPT_ID`, or `SA360_SMS_CANARY_RECIPIENT_E164` blocks
historical notice discovery, the generic dispatch route, and the worker's
notice HTTP call. The only send path is
`POST /admin/v1/external-webhook-notice/internal/sms-canary`, and it places at
most one SMS for the one matching attempt and recipient. It does not send email.
An uncertain or accepted send is not retried.

Leave `SA360_EXTERNAL_WEBHOOK_NOTICE_DISPATCH_ENABLED`,
`SA360_SMS_NOTIFICATIONS_ENABLED`, and `SA360_SMS_INBOUND_OPT_OUT_ENABLED` unset
in production. This change does not set them.

## GO / NO-GO

1. Toll-free verification submission: NO-GO. The number exists and its
   compliance profile is complete, but the opt-in page is not deployed, the
   Privacy Policy and Terms URLs are not configured, and a reviewer cannot yet
   open the live unchecked form.
2. One internal SMS canary: NO-GO to execute. The isolation code can be tested
   with mocks. A live send still needs verification Approved, a Messaging
   Service that contains only `+18884095462`, callback URLs, legal URLs, one
   sandbox recipient who confirmed through the link, and the canary variables
   set for that one shot. Do not point callbacks at production before approval.
3. Customer activation: NO-GO.
