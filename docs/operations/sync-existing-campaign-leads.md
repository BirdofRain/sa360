# Sync existing campaign leads

Follow-up requirement only. This document does not authorize a replay, a
historical write, a flag change, a routing change, or a GHL change. There is
no sync command in the API or worker today.

Company Sheets intents are created inside the intake transaction by
`recordCompanySheetsCampaignIntent`. That function returns without inserting
when `SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED` is not exactly `true` on
the API process. It does not scan older `SourceLeadEvent` rows. A confirmed
source association is enough for a new intent: the recorder does not require a
`matchedRuleId`. Direct GHL delivery is a different path.
`buildShadowDeliveryPlanSteps` blocks a matched decision that has no rule, and
LeadCapture intake does not generate a GHL plan.

## Known missing Sheets deliveries

Read at 5:26 PM ET on Monday, October 26, 2026. Client `alex_gross`. Campaign
switch on. Cutoff `2026-10-26T13:26:10.483Z`. API dispatch unset. Sheets intent
count 0. Both events are `routing_matched` by confirmed source association
`cmvlhdwmn00e3kg0ut2xyqpzl` (`parent_url_key`
`go.lifeinsuranceforvets.com/learn-alex-gross`). Neither has a delivery result.

| Source event | Received (ET) | Provider lead id | Routing decision |
| --- | --- | --- | --- |
| `cmvpnegvb018ui70umwn384h8` | 3:27 PM | `27fe3406-8b9a-49fe-a115-7cbeffc260b7` | `cmvpnegwi018vi70uaqbyqf0v` |
| `cmvppnm3u01ebi70u3kby86wo` | 4:30 PM | `dd0c2e31-7b26-4820-8046-ce044f5ff97f` | `cmvppnm5g01eci70ua7fhjahy` |

Do not replay these events to create the missing intents. A later sync has to
select them explicitly.

## What the sync must do

One operator action, with a preview before any write, for each destination.
Sheets and GHL are separate destinations. A successful Sheets row does not
count as GHL delivery, and a GHL contact does not count as a Sheets row.

Destination-specific deduplication:

- Sheets identity is the existing idempotency key
  `campaign:{clientAccountId}:{sourceLeadEventId}` and the delivery key
  `lead:{clientAccountId}:{sourceLeadEventId}`. A succeeded job or a row whose
  stable id is already on that spreadsheet and worksheet is a skip.
- The same phone or email on a different spreadsheet, worksheet, or GHL
  location is a different destination and is not a skip by itself.
- GHL identity is the configured location id plus the source event. A contact
  in another subaccount is not delivery to this location.

Previews:

- Show the source event ids, the destination spreadsheet id and worksheet gid
  or the GHL location id, and the skip reason for each row.
- Write nothing until a separate authorization accepts that preview.

Missing-delivery recovery:

- Include post-cutoff `routing_matched` leads for the named client that have
  no succeeded delivery to the named destination.
- Leave pre-cutoff leads out unless the preview names them one by one.
- The current Alex cutoff stays `2026-10-26T13:26:10.483Z`.

New-destination history:

- Saving a spreadsheet, binding a tab, or connecting a GHL location does not
  copy history.
- Turning API dispatch or execution on does not copy history.
- History for a newly bound destination waits for this preview.

Uncertain-outcome reconciliation:

- A Sheets job with `appendStartedAt` set, or status `uncertain`, is not
  retried, deleted, or lock-released by the sync.
- The preview lists those jobs and stops their source events out of the write
  set.
- A GHL attempt whose result is unknown stays out of the write set until a
  separate reconcile says whether the contact exists in the target location.

The sync must not enable API dispatch, API execution, a client delivery
switch, GHL `deliveryEnabled`, a snapshot install, or a workflow.
