# LAL AI BOT-1 VET workflow correction — preparation record

Read-only preparation on 2026-11-04. No GoHighLevel workflow was opened, copied,
edited, published, or enrolled. No lead was sent. Delivery was not activated.
The edits below are the procedure for a later pass, after the evidence sheet
is filled from a live session.

This record coordinates with the COC setup agent
(`bc-d61815fb-e525-408c-a16d-b063bbe940f5`, branch
`cursor/coc-ghl-setup-ui-40f5`). That agent owns the Admin C.O.C. mapping UI
and was still reading code when this record was written. It has not edited
files. This document does not change that UI, the delivery writer, or Prisma.

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

| ID or name | Where it came from | Why it is not the source |
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

PR #277 executor order, after a contact id exists:

1. `POST /contacts/upsert` — identity and, on that PR, native `firstName`, `lastName`, `email`, `phone`, `address1`, `city`, `state`, `postalCode`, `country`, `dateOfBirth` (`YYYY-MM-DD` only), `source`. Custom fields are not on this body. Timezone is not a native key.
2. Custom-field `PUT`, then source-attribute `PUT`.
3. Optional intake note, only when `intakeSummaryNotesEnabled` is boolean `true`.
4. `POST /contacts/{id}/tags` with niche, source, `SA360::EVENT::LEAD_CREATED`, and the client tag. This add does not replace other tags. It still runs when a failed stamp has already blocked workflow enrollment.
5. Opportunity and owner.
6. One enrollment step: `tag_trigger` adds `SA360::TRIGGER::NEW_LEAD`, or `direct_api` calls `POST /contacts/{id}/workflow/{destinationWorkflowIdGhl}` with no body. `direct_api` does not add `SA360::TRIGGER::NEW_LEAD`. Stored mode stays `tag_trigger` until an operator saves another mode. `proposedMode` is `direct_api` for display only (`changesExistingClients: false`).

Consequences for the live workflow, which this pass could not open:

| Mechanism | When it can fire | Required inspection |
| --- | --- | --- |
| Contact Created | On the upsert, before either custom-field `PUT`. | Every published workflow in the source location. A Contact Created trigger is an entry that runs before survey fields, lead type, and timezone exist. |
| `SA360::EVENT::LEAD_CREATED` | After the stamp attempt, including when stamp failed and enrollment was blocked. | Contact Tag Added filters. This tag is a second entry if the same contact is also enrolled by `direct_api` or by `SA360::TRIGGER::NEW_LEAD`. |
| `SA360::TRIGGER::NEW_LEAD` | Only when stored mode is `tag_trigger`, after tags, opportunity, and owner. | The shared preparation workflow may use this tag or direct API enrollment, not both. |
| Inbound webhook | Not sent by the location API. | Any trigger of type Inbound Webhook, and every action whose variable picker shows `inboundWebhookRequest`. |

`client_contact_created` is an internal SA360 lifecycle row. It is not a GHL trigger.

`inboundWebhookRequest` dependencies inside GHL are unverified. The repository has no step list. Until a workflow export lists them, any shared preparation or follow-up step that still reads `{{inboundWebhookRequest.*}}` has no body on the API path.

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
| Source location display name | Sub-account switcher and Settings → Business Profile. The two names must match. | |
| Source location id | URL segment after `/location/`. | |
| Proof it is LAL AI BOT-1 | Name plus URL. Sam's Test (`yCziKRW26eFg8IXAQZ73`) does not qualify by itself. | |
| Snapshot name, id, last updated | Agency → Snapshots. Do not push or load during this read. | |
| SA360 client account id | Admin C.O.C. client record. | |
| `destinationSubaccountIdGhl` | Client GHL destination. Must equal the source location id. | |
| `destinationWorkflowIdGhl` | Same destination row. | |
| `workflowTriggerMode` | Same row. Expect `tag_trigger` until an operator saves another mode. | |
| `sourceAttributeFieldMapJson` | Same row. Each key, field id, and discovered field name. | |
| Workflow id, name, folder, Published/Draft | Automation → Workflows. Id is the URL segment after the workflow path. | One row per workflow listed in section 7. |
| Trigger type and filters | Trigger card of each of those workflows. | |
| Allow re-entry and Allow multiple | Workflow settings gear, source location, read-only. | |
| Every `inboundWebhookRequest` reference | Builder search. Step name, variable path, field it should become. | |
| Assign User target | User id and name on the assignment action. | |
| Internal notification recipient | Action present or absent. Recipient. Do not send it. | |
| Lead type write | Native Lead Type, `sa360_lead_type`, and/or `sa360_lead_type_normalized`. | |
| Timezone branches | Section 8 worksheet. | |
| Handoff workflow id | Final Add to Workflow action. | |
| Test location id | Must differ from the source id and from `yCziKRW26eFg8IXAQZ73`. | |
| Outbound disabled | Test workflows in Draft. No connected sending domain or LC phone used by those drafts. | |

### Inspection clicks

1. Sign in to the agency at `https://app.gohighlevel.com` or the agency white-label domain. Stay on the agency view. Do not open Sam's Test as the starting location.
2. Open the sub-account switcher and search `LAL AI BOT-1`. Also search `LAL`, `BOT-1`, and `Veteran`. Write down every hit with its name and location id. Open a hit only to read Settings → Business Profile. Do not edit.
3. Switch to the agency. Open Snapshots. For each snapshot whose name contains LAL, BOT, VET, or AI, record name, id, and last-updated time. Do not click Push, Load, Refresh, or Share into a sub-account.
4. In Admin C.O.C., open the VET client and the GHL destination. Copy the subaccount id, workflow id, trigger mode, and field map. Stop if the subaccount id is empty or does not equal the location id from step 2.
5. In that source location only, open Automation → Workflows. Search `BOT-1`, `VET`, `M1A`, `Select Time Zone`, `timezone`, and `webhook`. For each match, open the builder, copy the workflow id from the URL, and record status, trigger, re-entry, and the settings gear. Use the builder search box for `inboundWebhookRequest`, `SA360::EVENT::LEAD_CREATED`, `SA360::TRIGGER::NEW_LEAD`, `Timezone`, and `Lead Type`.
6. Open every If/Else that mentions state, city, postal code, area code, country, or timezone. Fill section 8. Do not change a branch.
7. Screenshot the trigger card, the re-entry toggles, each timezone branch, the assignment action, the notification action, the lead-type action, and the final Add to Workflow action. Redact phone numbers and message bodies.

## 7. Edits allowed only after section 6 is complete

Work only in a new sub-account created from the recorded snapshot. Name it so the test role is obvious, for example `LAL AI BOT-1 VET TEST outbound off`. Its location id must differ from the source and from Sam's Test. Do not duplicate the workflow inside the source location. Do not load the edited snapshot back onto the source. Leave every test workflow in Draft. Disable Send SMS, Send Email, Send WhatsApp, Call, Voicemail, and live internal email in the test copy. Do not publish. Do not run a live lead. Do not mark the client destination active.

### Legacy webhook adapter

New test workflow, suggested name `VET Legacy Webhook Adapter (test, outbound off)`.

- Trigger: Inbound Webhook only. Remove Contact Created, tag, and form triggers from this copy.
- Actions write each inbound value onto the persisted contact field from the saved map (Update Contact Field). After this workflow, no later step needs `inboundWebhookRequest`.
- Do not add a Create Contact action. On the trigger mapping, update the existing contact. Match by GHL contact id, then email, then phone. An API-upserted contact must not be created again.
- Last action: Add to Workflow, targeting the shared preparation workflow id in the test location. Do not also add `SA360::TRIGGER::NEW_LEAD` or `SA360::EVENT::LEAD_CREATED`.
- The location API never calls this workflow. It exists so an old inbound webhook can still fill contact fields. One SA360 delivery event uses one entry: either this webhook path or the API path, not both.

### Shared VET preparation

Copy of the audited BOT-1 / VET preparation workflow in the test location. Suggested name `VET Shared Preparation (test, outbound off)`.

- API-fed steps read persisted contact fields only (`{{contact.*}}` and custom fields). Replace each `{{inboundWebhookRequest.*}}` with the contact field the adapter or the API stamp writes. If no contact field exists, stop and record the gap. Do not leave a webhook variable in this workflow or in its follow-up.
- One entry:
  - Saved mode will be `direct_api`: delete every trigger, including Contact Created, `SA360::EVENT::LEAD_CREATED`, and `SA360::TRIGGER::NEW_LEAD`. Enrollment is only the API `POST /contacts/{id}/workflow/{this workflow id}`.
  - Saved mode stays `tag_trigger`: the only trigger is Contact Tag Added for `SA360::TRIGGER::NEW_LEAD`. Remove Contact Created and `SA360::EVENT::LEAD_CREATED`.
  - Do not configure both.
- Removing a tag listener here does not stop the API from posting `SA360::EVENT::LEAD_CREATED`. The delivery writer owns that post. This task does not change it. A published listener on that tag is still a second entry.
- Preserve these actions and record their targets before saving the test copy:
  - Assign User. Keep the same user id.
  - Internal notification. Keep the action in the canvas, and disable the send in this test copy. Record the original recipient.
  - Lead type write. Keep the same target field. When the field is empty, the client value is VET. Do not overwrite a non-empty value.
  - Timezone writes from section 8.
  - Final Add to Workflow. Point it at the same follow-up workflow the source uses. Record that id. Do not retarget it to a draft voice workflow unless the source handoff already does.
- Workflow settings in the test copy: Allow re-entry off, so a later API field update does not assign, notify, and hand off a second time. Record the source toggle before changing the test copy.

### Timezone worksheet

SA360 does not write native Timezone or `sa360_timezone` before enrollment. PR #277's native upsert keys stop at name, email, phone, address, city, state, postal code, country, date of birth, and source. M2B Timing Gate reads `sa360_timezone`, `sa360_client_text_start_hour`, and `sa360_client_text_end_hour`. Those hour fields are not written by the audited delivery contract. The handoff to follow-up must come after the timezone write, and only if the hour fields are already on the contact or are written in this same preparation workflow. Record which.

For each branch:

| Branch | Condition | Writes native Timezone | Writes `sa360_timezone` | Missing location | Ambiguous location | Message field read |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

Missing means state, city, and postal code are all empty. Ambiguous means the state has more than one zone or the lookup returns blank. Do not invent a fallback zone. Copy the source branch, and record it.

Message custom values named in the May 2026 registry (`SA360_MSG_M2FT_BLUE_*`, `SA360_MSG_M2FT_GREEN_*`, `SA360_MSG_M2C_BLUE_*`, `SA360_MSG_M2C_GREEN_*`, `SA360_MSG_M2C5_*`) must not reference `inboundWebhookRequest`. Leave their send actions disabled in the test copy.

## 8. COC coordination

Left untouched for the COC agent: `ghl-walkthrough-panel.tsx`, `ghl-field-mapping-select.tsx`, `ghl-field-coverage.ts`, `source-field-mapping-section.tsx`, `client-ghl-destination-section.tsx`, and the admin-coc types that display `vetWorkflowTriggerProposal`.

Still required from a live session before that UI can show verified VET data:

- Published LAL AI BOT-1 workflow id, and the location id that actually contains it.
- The client's saved `sourceAttributeFieldMapJson`, including the real field for `applied_for_other_insurance`.
- Whether Contact Created, `SA360::EVENT::LEAD_CREATED`, or `SA360::TRIGGER::NEW_LEAD` is published on that workflow.
- The step list that reads `inboundWebhookRequest`.
- Select Time Zone workflow id, snapshot name, snapshot id, and last-updated time.

The COC UI cannot prove those GHL triggers are absent. This preparation does not change that. Saving a destination must not send a lead, enroll a contact, or activate delivery.

## 9. Stop conditions

Stop and do not edit if:

- The location switcher name and the Business Profile name differ.
- The only located id is `yCziKRW26eFg8IXAQZ73`, `VPuMIhN6JpxdoXvvlekZ`, or `9xSNvQCbGaPE9YNxgl4B`.
- The COC destination subaccount id does not equal the location id in the workflow URL.
- The snapshot id or last-updated time cannot be read.
- The test location id equals the source location id.
- Any test workflow would remain Published, or a send action would remain enabled.
