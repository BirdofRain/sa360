# LAL AI BOT-1 VET workflow correction — preparation record

Read-only preparation on 2026-11-04. No GoHighLevel workflow was opened, copied,
edited, published, or enrolled. No lead was sent. Delivery was not activated.
The edits below are the procedure for a later pass, after the evidence sheet
is filled from a live session.

This record coordinates with the COC setup PR #280
(`cursor/coc-ghl-setup-ui-40f5`, head `7e787e86fbdbad0a08ddcb7f119191227d127db4`),
which is stacked on PR #277. This document does not change that UI, the
delivery writer, or Prisma.

Three locations stay separate. Their ids are recorded on their own rows and
are not required to match.

| Location | What it is | What it is not |
| --- | --- | --- |
| Snapshot source | The agency snapshot the workflow canvas was copied from, plus the sub-account that snapshot was taken from when that sub-account can be identified. | Not the client destination, and not the place where a draft is edited. |
| Client destination | The GoHighLevel location SA360 is configured to write (`destinationSubaccountIdGhl`), with that row's workflow id and field map. | Not required to equal the snapshot source location id. |
| Isolated test location | A different sub-account used only for draft preparation. | Not the client destination, not Sam's Test, and not a location where a lead is sent. |

## 1. What was verified

| Check | Result |
| --- | --- |
| Local `ClientGhlDestination` rows | 0 |
| Local `GhlLocationConfigSnapshot` rows | 0 |
| GHL / LeadConnector credentials in this environment | None. `.env` has only local `DATABASE_URL`, `REDIS_URL`, test URLs, and `NODE_ENV`. |
| Live GHL API or UI session | Not available. |
| String `inboundWebhookRequest` in the repository | Absent. The location API does not send a webhook body. |
| `LAL AI BOT-1` workflow id in the repository | Absent. |
| Saved VET `sourceAttributeFieldMapJson` | Absent. Column default is `{}`. |

Prior audit: `docs/validation/vet-lal-ai-bot-1-delivery-contract.md` on
`cursor/vet-lal-bot-delivery-contract-dbdb` (PR #276), against `master` at
`f04906e6aa4793f594071d44460998bf5b861c16`. That audit also did not call
GoHighLevel. Screenshot inventory `ghl_screenshot_inventory_2026_05_08` is a
name list from May 2026, not a current export and not a snapshot revision.

Delivery writer under review, not merged: PR #277
(`cursor/vet-ghl-delivery-contract-0184`, head
`1ab4bb495382d00e1031b2102e1abc5aa8b56084`). The COC agent is building on that
head. This preparation uses that writer's order. It does not copy
`proposedMode` onto any client.

## 2. Locations that are not the authoritative source

Do not treat any row below as LAL AI BOT-1. None was confirmed by a live
location name plus URL.

| ID or name | Where it came from | Why it is not the client destination |
| --- | --- | --- |
| `yCziKRW26eFg8IXAQZ73` | `SAM_TEST_GHL_LOCATION_ID`. Display name in tests: Sam's Test. | Survey text-field creation is limited to this id. The audit states it is not confirmed as the BOT-1 production location. |
| `VPuMIhN6JpxdoXvvlekZ` | Direct-demo allowlist. | Demo location. |
| `9xSNvQCbGaPE9YNxgl4B` | Repo test pairing with client `vet_life_james_torrey`. | No location display name in the repo. Not a saved destination row. |
| `d4c1fa4c-a3e2-4fd8-9091-b3fad0d04edd` | Walkthrough and test workflow id. | Fixture. Not Select Time Zone and not BOT-1. |
| `select time zone` | Onboarding name match only. Saved per client on `destinationWorkflowIdGhl`. | Name verified in code. Id unverified. Local destinations: 0. |
| `LAL AI BOT-1` | Task name. | Absent from the repo. |

Client account ids that appear in repo fixtures, and are not a saved GHL
destination: master `lal_master_vet`, pilot `vet_life_james_torrey`, campaign
`LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX`. Confirm the live client in
Admin C.O.C. before using any of them.

## 3. Snapshot revision and workflow IDs

Both are unverified.

| Record | Value |
| --- | --- |
| Snapshot name | Unverified |
| Snapshot id | Unverified |
| Snapshot last-updated timestamp | Unverified |
| `snapshotInstalled` | Boolean on `ClientGhlDestination`. Not a revision id. Zero local rows. |
| LAL AI BOT-1 workflow id | Unverified |
| Legacy webhook adapter workflow id | Unverified |
| Shared VET preparation workflow id | Unverified |
| Select Time Zone workflow id | Unverified |
| Follow-up / handoff workflow id | Unverified |

May 2026 screenshot names to search for, with no UUIDs: `M1A - New Lead Intake - Veteran`, `M1B - Normalize and Lock Lead`, `M1C - Send Off`, `M2B - Timing Gate`, `M2D - AI Handoff`, and the onboarding name `Select Time Zone`. Published/draft and enrolled counts in `docs/registry/sa360-workflows.csv` are from that screenshot set.

## 4. Triggers that can start work before fields are finished

PR #277 executor order, after a contact id exists. These are repository
observations. Whether any published workflow in the client destination listens
for them is unverified.

1. `POST /contacts/upsert` — identity and, on that PR, native `firstName`, `lastName`, `email`, `phone`, `address1`, `city`, `state`, `postalCode`, `country`, `dateOfBirth` (`YYYY-MM-DD` only), `source`. Custom fields are not on this body. Timezone is not a native key.
2. Custom-field `PUT`, then source-attribute `PUT`.
3. Optional intake note, only when `intakeSummaryNotesEnabled` is boolean `true`.
4. `POST /contacts/{id}/tags` adds niche, source, and client tags and does not replace other tags. On the reviewed head `1ab4bb49` it also posts `SA360::EVENT::LEAD_CREATED` after a required stamp failure has already blocked explicit enrollment. Correction `cursor/withhold-automation-entry-tag-dc3b` withholds `SA360::EVENT::LEAD_CREATED`, `SA360::TRIGGER::NEW_LEAD`, and `SA360::TRIGGER::AI_READY` from that post while the required-write gate is closed, and still posts the niche, source, and client tags. Until the branch under test contains that correction, treat the event tag as a possible entry even when enrollment is blocked.
5. Opportunity and owner.
6. One enrollment step, only when the required-write gate is open: `tag_trigger` adds `SA360::TRIGGER::NEW_LEAD`, or `direct_api` calls `POST /contacts/{id}/workflow/{destinationWorkflowIdGhl}` with no body. `direct_api` does not add `SA360::TRIGGER::NEW_LEAD`. Stored mode stays `tag_trigger` until an operator saves another mode. `proposedMode` is `direct_api` for display only (`changesExistingClients: false`).

If a published workflow uses one of the mechanisms below, the timing is the code order above. This pass did not open a workflow, so none of these listeners is confirmed or ruled out.

| Mechanism | If it is configured | What remains unverified |
| --- | --- | --- |
| Contact Created | It can run on the upsert, before either custom-field `PUT`, and before survey fields, lead type, and timezone exist. Withholding a later tag does not stop it. | Whether any published workflow in the client destination uses Contact Created. |
| `SA360::EVENT::LEAD_CREATED` | On the reviewed writer it is posted with the routing tags, including when explicit enrollment is blocked. After the correction, it is posted only when that gate is open, including a later resume that posts the withheld tag alone. It can be a second entry beside `direct_api` or `SA360::TRIGGER::NEW_LEAD`. | Whether a Contact Tag Added filter on this tag is published. |
| `SA360::TRIGGER::NEW_LEAD` | Only when stored mode is `tag_trigger` and the required-write gate is open, after tags, opportunity, and owner. | Whether the preparation workflow uses this tag, direct API enrollment, both, or neither. |
| `SA360::TRIGGER::AI_READY` | Posted only on the same gated `tag_trigger` step, and only when enrichment says automation is ready. | Whether a listener on this tag is published. |
| Inbound webhook | The location API does not send a webhook body. | Any trigger of type Inbound Webhook, and every action whose variable picker shows `inboundWebhookRequest`. |

`client_contact_created` is an internal SA360 lifecycle row. It is not a GHL trigger.

`inboundWebhookRequest` dependencies inside GHL are unverified. The repository has no step list. Until a workflow export lists them, a step that still reads `{{inboundWebhookRequest.*}}` has no body on the API path. Do not describe that as a confirmed live dependency.

## 5. Field map

The saved map was not readable. Zero destination rows. The stamp writes the saved field id and does not check the GHL display name.

Intended names from the audit and the Sam's Test planner, not live ids:

| Source key | Intended contact field name |
| --- | --- |
| `branch_of_service` | Branch of Service |
| `desired_coverage` | Desired Coverage Range |
| `primary_reason` | Primary Reason |
| `applied_for_other_insurance` | No code default. Screenshot display name only: `vot - applied for other insurance`. Do not invent an id. |

The COC agent owns display of the saved id next to the discovered name, stale ids, and duplicate targets. Do not auto-save a guessed preset from this preparation.

## 6. Evidence to collect before any edit

Fill every cell. If a cell is empty, do not edit.

| Evidence | Where to read it | Value |
| --- | --- | --- |
| Snapshot source name, id, last updated | Agency → Snapshots. Do not push or load during this read. | |
| Snapshot source location id, if the snapshot belongs to a sub-account | Snapshot detail. Leave blank when the snapshot is not tied to one location. | |
| Client destination display name | Sub-account switcher and Settings → Business Profile for the destination location. The two names must match each other. They do not have to match the snapshot name. | |
| Client destination location id (`destinationSubaccountIdGhl`) | Admin C.O.C. client GHL destination, and the URL segment after `/location/` when that destination is open. Record both. They are not required to equal the snapshot source location id. | |
| SA360 client account id | Admin C.O.C. client record. | |
| Isolated test location id | The sub-account used for draft preparation. It must differ from the client destination and from Sam's Test (`yCziKRW26eFg8IXAQZ73`). | |
| `destinationWorkflowIdGhl` | Client destination row. Also record the location id in that workflow's URL. A difference from `destinationSubaccountIdGhl` is a finding to keep, not a requirement that the ids match. | |
| `workflowTriggerMode` | Same destination row. Expect `tag_trigger` until an operator saves another mode. | |
| `sourceAttributeFieldMapJson` | Same row. Each key, field id, and discovered field name. | |
| Workflow id, name, folder, Published/Draft | Automation → Workflows in the location being read. Say which of the three locations that workflow is in. | One row per workflow listed for draft preparation. |
| Trigger type and filters | Trigger card of each of those workflows. Unverified until this cell is filled. | |
| Allow re-entry and Allow multiple | Workflow settings gear, read-only, in the location being read. | |
| Every `inboundWebhookRequest` reference | Builder search. Step name, variable path, field it should become. Absent from the repo. | |
| Assign User target | User id and name on the assignment action. | |
| Internal notification recipient | Action present or absent. Recipient. Do not send it. | |
| Lead type write | Native Lead Type, `sa360_lead_type`, and/or `sa360_lead_type_normalized`. | |
| Timezone branches | Timezone worksheet below. | |
| Handoff workflow id | Final Add to Workflow action. | |
| Outbound disabled in the isolated test location | Draft workflows only. No connected sending domain or LC phone used by those drafts. | |

### Inspection clicks

1. Sign in to the agency at `https://app.gohighlevel.com` or the agency white-label domain. Stay on the agency view. Do not open Sam's Test as the starting location.
2. Open Snapshots. For each snapshot whose name contains LAL, BOT, VET, or AI, record the snapshot name, snapshot id, and last-updated time. If the snapshot detail names a sub-account, record that location id as the snapshot source location. Do not click Push, Load, Refresh, or Share.
3. Open the sub-account switcher and search `LAL AI BOT-1`, `LAL`, `BOT-1`, and `Veteran`. Write down every hit with its name and location id. Open a hit only to read Settings → Business Profile. Do not edit. Label each hit as a candidate client destination or as something else. Do not assume the first hit is the snapshot source.
4. In Admin C.O.C., open the VET client and the GHL destination. Copy the subaccount id, workflow id, trigger mode, and field map. An empty subaccount id means the client destination is not configured. A subaccount id that differs from a snapshot source location id is allowed. Record the difference.
5. In the client destination, open Automation → Workflows. Search `BOT-1`, `VET`, `M1A`, `Select Time Zone`, `timezone`, and `webhook`. For each match, copy the workflow id and the location id from the URL, and record status, trigger, re-entry, and the settings gear. Use the builder search box for `inboundWebhookRequest`, `SA360::EVENT::LEAD_CREATED`, `SA360::TRIGGER::NEW_LEAD`, `Timezone`, and `Lead Type`. A workflow URL location that differs from `destinationSubaccountIdGhl` stays on the sheet as a finding.
6. Open every If/Else that mentions state, city, postal code, area code, country, or timezone. Fill the timezone worksheet. Do not change a branch.
7. Screenshot the trigger card, the re-entry toggles, each timezone branch, the assignment action, the notification action, the lead-type action, and the final Add to Workflow action. Redact phone numbers and message bodies.

## 7. Draft preparation, after section 6 is complete

This section prepares a draft in the isolated test location. It is not an execution test. Filling the evidence sheet does not authorize a lead send, an enrollment, a publish, or a delivery activation. A later authorized execution test is a separate decision after the draft has been reviewed. Do not run that test from this procedure.

Create the isolated test location from the recorded snapshot. Name it so the draft role is obvious, for example `LAL AI BOT-1 VET TEST outbound off`. Its location id must differ from the client destination and from Sam's Test. It does not have to differ from a snapshot id; a snapshot id and a location id are different kinds of ids. Do not duplicate the workflow inside the client destination. Do not load the edited snapshot back onto the client destination or onto the snapshot source. Leave every test workflow in Draft. Disable Send SMS, Send Email, Send WhatsApp, Call, Voicemail, and live internal email in the draft. Do not publish. Do not run a lead. Do not mark the client destination active.

### Legacy webhook adapter

Draft workflow, suggested name `VET Legacy Webhook Adapter (draft, outbound off)`.

- Trigger: Inbound Webhook only. Remove Contact Created, tag, and form triggers from this draft.
- Contact creation follows the real upstream webhook contract, which this repository does not contain. Do not prescribe Create Contact or update-only until that contract is read. If the upstream body addresses an existing contact, do not create a second contact. If that contract is the contact's first write, creating the contact stays part of the adapter. Record which of those the payload actually does, and stop if the payload is still unknown.
- Field writes use the saved map (Update Contact Field) for values the contract supplies. After this workflow, no later step needs `inboundWebhookRequest` for those values. If the contract has a value with no contact field, stop and record the gap.
- Last action: Add to Workflow, targeting the shared preparation workflow id in the isolated test location. Do not also add `SA360::TRIGGER::NEW_LEAD` or `SA360::EVENT::LEAD_CREATED`.
- The location API does not call this workflow. It exists so an old inbound webhook can still fill contact fields when that upstream contract says so. One SA360 delivery event uses one entry: either this webhook path or the API path, not both.

### Shared VET preparation

Draft copy of the preparation workflow in the isolated test location. Suggested name `VET Shared Preparation (draft, outbound off)`.

- API-fed steps read persisted contact fields only (`{{contact.*}}` and custom fields). Replace each `{{inboundWebhookRequest.*}}` with the contact field the adapter or the API stamp writes. If no contact field exists, stop and record the gap. Do not leave a webhook variable in this workflow or in its follow-up.
- One entry:
  - Saved mode will be `direct_api`: delete every trigger, including Contact Created, `SA360::EVENT::LEAD_CREATED`, and `SA360::TRIGGER::NEW_LEAD`. Enrollment is only the API `POST /contacts/{id}/workflow/{this workflow id}`.
  - Saved mode stays `tag_trigger`: the only trigger is Contact Tag Added for `SA360::TRIGGER::NEW_LEAD`. Remove Contact Created and `SA360::EVENT::LEAD_CREATED`.
  - Do not configure both.
- Removing a tag listener in this draft does not change the API. On reviewed head `1ab4bb49` the writer still posts `SA360::EVENT::LEAD_CREATED` when enrollment is blocked. The correction branch withholds that tag, and `SA360::TRIGGER::NEW_LEAD` and `SA360::TRIGGER::AI_READY`, only while the required-write gate is closed. If a listener on the event tag is published, it is still a second entry on any run where the gate is open. Whether that listener exists is unverified.
- Preserve these actions and record their targets before saving the test copy:
  - Assign User. Keep the same user id.
  - Internal notification. Keep the action in the canvas, and disable the send in this test copy. Record the original recipient.
  - Lead type write. Keep the same target field. When the field is empty, the client value is VET. Do not overwrite a non-empty value.
  - Timezone writes from the worksheet below.
  - Final Add to Workflow. Point it at the same follow-up workflow the client destination uses. Record that id. Do not retarget it to a draft voice workflow unless that destination's handoff already does.
- Workflow settings in the draft: Allow re-entry off, so a later API field update does not assign, notify, and hand off a second time. Record the client destination's toggle before changing the draft.

### Timezone worksheet

SA360 does not write native Timezone or `sa360_timezone` before enrollment. PR #277's native upsert keys stop at name, email, phone, address, city, state, postal code, country, date of birth, and source. M2B Timing Gate reads `sa360_timezone`, `sa360_client_text_start_hour`, and `sa360_client_text_end_hour`. Those hour fields are not written by the audited delivery contract. The handoff to follow-up must come after the timezone write, and only if the hour fields are already on the contact or are written in this same preparation workflow. Record which.

For each branch:

| Branch | Condition | Writes native Timezone | Writes `sa360_timezone` | Missing location | Ambiguous location | Message field read |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

Missing means state, city, and postal code are all empty. Ambiguous means the state has more than one zone or the lookup returns blank. Do not invent a fallback zone. Copy the client destination's branch, and record it.

Message custom values named in the May 2026 registry (`SA360_MSG_M2FT_BLUE_*`, `SA360_MSG_M2FT_GREEN_*`, `SA360_MSG_M2C_BLUE_*`, `SA360_MSG_M2C_GREEN_*`, `SA360_MSG_M2C5_*`) must not reference `inboundWebhookRequest`. Leave their send actions disabled in the test copy.

## 8. COC coordination

PR #280 owns the mapping screen. This document still does not edit it.

Still required from a live session before that UI can show verified VET data:

- The client destination location id and the workflow id saved on that destination. The snapshot source location id is a separate cell.
- The client's saved `sourceAttributeFieldMapJson`, including the real field for `applied_for_other_insurance`.
- If Contact Created, `SA360::EVENT::LEAD_CREATED`, or `SA360::TRIGGER::NEW_LEAD` is published on that workflow. Absence is unverified until the trigger card is read.
- The step list that reads `inboundWebhookRequest`, if a builder search finds any.
- Select Time Zone workflow id, snapshot name, snapshot id, and last-updated time.

The COC UI cannot prove those GHL triggers are absent. Saving a destination must not send a lead, enroll a contact, or activate delivery. Draft preparation is not that save, and it is not an execution test.

## 9. Stop conditions

Stop and do not edit if:

- The client destination's switcher name and its Business Profile name differ.
- The snapshot source, the client destination, and the isolated test location cannot be told apart on the sheet.
- The only located id is `yCziKRW26eFg8IXAQZ73`, `VPuMIhN6JpxdoXvvlekZ`, or `9xSNvQCbGaPE9YNxgl4B`.
- The snapshot id or last-updated time cannot be read.
- The isolated test location id equals the client destination location id, or equals Sam's Test.
- The upstream webhook contract is still unknown and the draft would have to guess whether it creates a contact.
- Any draft workflow would remain Published, or a send action would remain enabled.
- The next step would send a lead, enroll a contact, publish a workflow, or activate delivery. That is later authorized execution testing, not this draft.
