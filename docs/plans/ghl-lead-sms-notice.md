# GHL lead-received SMS

Operational notice after SA360 persists a GoHighLevel contact write.
This document is the registration evidence and the verification checklist.
It does not enable a flag, submit toll-free verification, or send an SMS.

## Use case

Send one SMS to the opted-in client recipient after SA360 creates or updates
a lead contact in that client's connected GoHighLevel location.

The trigger is `ghlContactReceived` on a finished `ongoing_association`
`GhlLiveDeliveryRun`. The contact step must store a `vetOperationReceipt`
with operation `contact`, outcome `completed`, and an external contact id.
The `GhlAssociationDispatchOutbox` row for that run must name the same
client, location, and source lead. The source lead must be a real production
lead: not a bulk import, not `synthetic-campaign-test`, and not an onboarding
test key.

Workflow enrollment is not part of this proof. A failed or ambiguous
`start_workflow` step can leave the run `failed` and the outbox `uncertain`
without removing the contact receipt. That contact still qualifies.
`canonicalGhlDelivery` can stay false in that case.

These are not the trigger:

- HTTP acceptance of an external delivery webhook
- A Company Sheets append
- A simulated, canary, `location_api`, or paused-location run
- A run that is still `executing` or was `skipped_duplicate`
- A contact step with HTTP 2xx and no stored contact receipt
- A contact step with no external id
- A historical bulk-import lead
- A second delivery attempt for the same source lead and location

## Receipt

Table: `GhlLeadReceivedNotice`.

Event and template: `ghl_lead_received`.

Idempotency key: `ghl_lead_received:{clientAccountId}:{sourceLeadEventId}:{locationIdGhl}`.
The recipient phone is not part of the key. The live run id is evidence of
the first proof and is not part of the key.

The first discovery pass inserts `GhlLeadNoticeDiscoveryCursor` at the current
time and scans nothing. Later passes read only runs completed after that
cutoff. Turning the flag on does not text the existing history.

## Sample message

`SA360: A new lead was received in your GoHighLevel account. Open GHL to view it. Reply STOP to opt out.`

The body has no consumer name, phone, email, or contact id. `Reply HELP for help`
and `Message and data rates may apply` stay in the opt-in disclosure. They are
not in this sample because the operational body is fixed to the sentence above.
A Twilio reviewer should see both the sample and the opt-in disclosure.

## Opt-in disclosure

New records use version `ghl-lead-sms-v1`:

`Life Agent Launch may text this number when a lead is received in your GoHighLevel account.`

The rest of the sentence is frequency, message and data rates, STOP, HELP,
the Privacy Policy URL, and the Terms URL. Both URLs must already be public
https pages. This repository does not invent them.

`external-webhook-sms-v1` and `external-webhook-sms-v2` stay valid for the
rows that already store them. Those versions still authorize only the
external-webhook notice, whose template is unchanged:

`Life Agent Launch: a delivery webhook was accepted. Reply STOP to opt out. Reply HELP for help. Msg & data rates may apply.`

A later opt-in call does not replace a stored v1 or v2 row. It returns
`prior_consent_retained`. An operator must not clear that row to make this
SMS send. A person who already confirmed v2 needs a new affirmative consent
before this program can text them, and the current link will not overwrite
the stored consent.

## Send path

The worker queue is `ghl-lead-notice`. It calls
`POST /admin/v1/ghl-lead-notice/internal/discover` and
`POST /admin/v1/ghl-lead-notice/internal/dispatch`.
Intake handlers and association settlement do not call those routes.

`SA360_GHL_LEAD_NOTICE_ENABLED` must be the exact string `true` before
discovery or dispatch runs. It is unset in this change.

`SA360_SMS_NOTIFICATIONS_ENABLED` must also be the exact string `true`
before Twilio is called. It is unset in this change. Discovery may record a
pending row while that switch is off. Dispatch then returns `sms_disabled`
and does not claim the row.

Canary isolation skips this queue whenever it is not `off`. STOP and Twilio
error 21610 suppress the preference and any pending GHL notice. Provider
status callbacks update a `GhlLeadReceivedNotice` only when the MessageSid is
not already an external-webhook receipt.

## Verification checklist

- [ ] One persisted contact receipt produces one `ghl_lead_received` row and one SMS body.
- [ ] A second run for the same source lead and location adds no row and no SMS.
- [ ] Sheets-only evidence returns `sheets_only` and writes no row.
- [ ] A failed or unproven contact write writes no row.
- [ ] Workflow enrollment failure after a proven contact write still leaves the contact id on the notice.
- [ ] STOP writes no additional SMS. A pending row becomes `suppressed`.
- [ ] A stored v2 consent row is not rewritten and does not receive this SMS.
- [ ] The external-webhook template string is unchanged.
- [ ] `SA360_GHL_LEAD_NOTICE_ENABLED` is unset.
- [ ] `SA360_SMS_NOTIFICATIONS_ENABLED` is unset.
- [ ] No toll-free verification is submitted.
- [ ] No live Twilio call is made from this change.
- [ ] The opt-in page is still not a published URL. Do not give it to Twilio until a reviewer can open the deployed page.
- [ ] Privacy Policy and Terms URLs are still operator-configured. Do not submit verification while they are empty.

## NO-GO

Do not enable either flag. Do not set `SA360_TWILIO_SMS_FROM`. Do not submit
toll-free verification. Do not send a live SMS. People with stored v1 or v2
consent are not enrolled in this message.
