# Monday company Sheets pilot

Operator runbook for one new client. Do not run this against production until a
separate authorization covers deployment and activation. This document does not
change flags, sharing, cutoffs, locks, or existing spreadsheets.

James Torrey's cutoff stays `2026-10-22T00:50:17.124Z`. Do not copy it onto the
new client. Do not turn off Matt's Zap.

## Before the pilot

1. Select one new client. Confirm both routing authorities:
   - the active campaign rule for that client's campaign id
   - the confirmed source association for the exact provider form, parent URL key, or hosted slug
2. Both must resolve to that client. Display names and UTM values are not routing authority.
3. Use a separate SA360 spreadsheet and tab from the Zapier sheet. Keep both running so counts can be compared.
4. On the company Google Sheets page:
   - confirm the company Google account
   - create or link the client folder by the client display name
   - select an existing sheet or create a new one, then save the destination
   - saving does not enable delivery
   - create the missing Campaign Leads tab with the veteran readable template (`company_sheets_campaign_v3`) only when that template's mapping review is ready
   - pass Test read access
   - pass Test write access and read it as a permission probe, not as proof that campaign leads arrive
5. The campaign-path synthetic delivery is not available from setup. It must go through the delivery writer, with execution authorized, and it must stay out of inventory, billing, and normal routing. An uncertain append is not retried.

## Activation

Use the existing sequence for this client only:

1. Deploy the setup release, including the additive folder and sheet-link migration, with dispatch and execution still off.
2. Enable API and worker dispatch. Confirm the 60-second repeatable and a zero-work tick.
3. Enable campaign delivery for this client through the activation control. If the client has no cutoff, activation sets it to that moment. It does not move an existing cutoff earlier.
4. Enable API execution.
5. Leave aged delivery, other clients, internal-test switches, and client Google OAuth off.

## What to compare

Watch natural arrivals only. Do not replay history and do not generate leads.

Compare SA360 with the Zap sheet where a source id exists:

- source ids
- counts
- generation timestamps, including rows whose source timestamp is blank
- contact fields
- niche answers that the template actually maps
- duplicates
- delivery delay

Repeated webhooks for the same lead must not create a second delivery. A later legitimate submission that happens to share a phone or email stays valid when the existing client and source deduplication rules say it is a different lead.

## Pause

Pause campaign delivery and API execution when any of these happen:

- an uncertain append or a lost claim
- a lead routed to the wrong client
- a worksheet lock that is still owned after the job stops making progress
- a header or destination that does not match the saved template

Keep the job, the intent, the cutoff, and the lock. Do not retry an ambiguous append. Do not release a lock from this runbook. Do not change sharing.

Resume only after the uncertain row is reconciled and a new authorization says to continue.
