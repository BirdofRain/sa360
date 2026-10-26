# Monday company Sheets pilot

Operator runbook for one new client. Do not run this against production until a
separate authorization covers deployment and activation. This document does not
change flags, sharing, cutoffs, locks, or existing spreadsheets.

James Torrey's cutoff stays `2026-10-22T00:50:17.124Z`. Do not copy it onto the
new client. Do not turn off Matt's Zap. Matt's Zap keeps writing to its own
comparison spreadsheet. The SA360 destination for this client is a different
spreadsheet and tab.

Read the live API and worker flags, and each relevant client's campaign and
aged switches, before changing anything. Do not assume they are all off. Do not
disable a pilot that is already running. Identify that client and leave it
alone unless a separate authorization names it.

Flags read from app `2c381355-37a1-415f-bf06-ad477add164e` at 7:53 PM EDT on
Sunday, October 25, 2026. The active deployment was
`fb497434-b3a2-4a23-89c8-6a3b1fd5b206` on commit `5aaa9d72`. This is a snapshot,
not permission to change it:

- `SA360_COMPANY_GOOGLE_SHEETS_ENABLED` is `true`
- `SA360_COMPANY_GOOGLE_OAUTH_ENABLED` is `true`
- `SA360_GOOGLE_OAUTH_ENABLED` is `false`
- `SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED` is unset, so dispatch is off
- `SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED` is unset, so execution is off

Leave the two `true` flags as they are. They are setup flags, not proof that a
client is receiving leads. Re-read the flags before Monday's action.

## States that are not interchangeable

These are five different facts. A later one does not imply an earlier one, and
an earlier one does not enable the next one.

1. Setup saved. The client folder, spreadsheet, and Campaign Leads tab are
   recorded. Delivery is still off for this client.
2. Permission checked. Check Write Permission reported that the company account
   can edit the spreadsheet. No test row was written.
3. Controlled writer test passed. Send Test Row appended one synthetic row
   through the bound campaign writer to the exact saved spreadsheet and tab.
   The row is not an inventory lead, a billed lead, or a routed lead. Automatic
   delivery is still off.
4. Automatic delivery enabled. This client's campaign switch is on, dispatch is
   on, and API execution is on. Aged delivery for this client stays off.
5. Natural end-to-end delivery verified. A real post-cutoff lead for this
   client appeared on the SA360 tab without a replay.

## Before any delivery flag

1. Select one new client. Confirm both routing authorities:
   - the active campaign rule for that client's campaign id
   - the confirmed source association for the exact provider form, parent URL key, or hosted slug
2. Both must resolve to that client. Display names and UTM values are not routing authority.
3. Give that client its own cutoff. Activation sets the cutoff to the moment
   campaign delivery is turned on only when the client has no cutoff yet. It
   does not move an existing cutoff earlier. Do not reuse
   `2026-10-22T00:50:17.124Z`.
4. On the company Google Sheets page, with company Google connected:
   - create or link the client folder by the client display name
   - select an existing sheet or create a new one
   - creating or selecting does not replace the saved destination
   - save the destination explicitly
   - create or bind the Campaign Leads tab
   - v3 is one shared column template, `company_sheets_campaign_v3`
   - choosing a niche does not change those columns
   - nurse, trucker, and mortgage answers are columns on that same template and stay blank when the lead did not store them
   - there is no separate niche header
5. Check Write Permission. The result must say that no test row was written.
6. Send Test Row only after the campaign tab is bound. The success text must
   name the saved spreadsheet and tab. Confirm that one synthetic row is on
   that tab, that no inventory or billing row was created, and that this
   client's campaign switch is still off.
7. If Send Test Row reports that a previous test did not confirm, stop. Do not
   send it again and do not delete a row. Reconcile that outcome under a
   separate authorization.

The controlled test uses the bound writer and does not turn delivery on. It is
the gate in front of natural client traffic. It is not a substitute for a
natural lead.

## Deployment order

The setup migration `20261023220000_company_sheets_setup_links` is additive. It
creates empty folder, folder-event, and spreadsheet-link tables. It does not
change existing destination rows.

1. Apply that migration to the application database before the new application
   code serves traffic. Old code ignores the new tables. New code fails closed
   on folder and spreadsheet-link reads if the tables are missing.
2. Deploy the application. Leave every flag and client switch as it was read
   in the preflight. Do not turn a running pilot off to deploy this.
3. Finish setup, the permission check, and the controlled writer test for the
   new client while that client's campaign and aged switches stay off.
4. Only after the controlled test has passed, and only for this client:
   - if API and worker dispatch are not already on for an identified pilot, enable them and confirm the 60-second repeatable and a zero-work tick
   - turn on campaign delivery for this client through the activation control
   - enable API execution only when every client whose campaign or aged switch is already on is an authorized pilot
5. Leave aged delivery off for this client. Leave other clients, the internal
   test client, and client Google OAuth unchanged.

Do not enable API execution merely to make Send Test Row work. The controlled
test does not use the global execution flag and must not be replaced with a
real lead.

## What to compare after natural traffic

Watch natural arrivals only. Do not replay history and do not generate leads.

Compare the SA360 tab with Matt's separate Zap sheet where a source id exists:

- source ids
- counts
- generation timestamps, including rows whose source timestamp is blank
- contact fields
- lead type, date of birth, notes, and niche answers that were actually stored
- duplicates
- delivery delay

A blank generation time stays blank. Delivery time is not written in its place.
Notes appear only when the stored unmapped source key normalizes to `notes`.

Repeated webhooks for the same lead must not create a second delivery. A later
legitimate submission that happens to share a phone or email stays valid when
the existing client and source deduplication rules say it is a different lead.

## Pause

Pause this client's campaign delivery, and pause API execution only when this
client is the only authorized writer, if any of these happen:

- an uncertain append or a lost claim
- a lead routed to the wrong client
- a worksheet lock that is still owned after the job stops making progress
- a header or destination that does not match the saved template

Keep the job, the intent, the cutoff, and the lock. Do not retry an ambiguous
append. Do not release a lock from this runbook. Do not change sharing. Do not
turn off Matt's Zap. Do not change James's cutoff.

Resume only after the uncertain row is reconciled and a new authorization says
to continue.

## Rollback

Application rollback is safe only after no tab setup row is still `creating`
and no client-folder row is still `creating`. Those claims last at most two
minutes. Dropping the new tables while the new code is running breaks folder
and spreadsheet-link setup. Leaving the tables in place while running the old
code is the rollback. Do not drop them as part of an application rollback.
