# VET / LAL AI BOT-1 delivery contract

Read-only audit of `master` at `f04906e6aa4793f594071d44460998bf5b861c16`
(merge of PR #275, 2026-11-03 6:24 PM America/New_York). No leads were sent,
no contacts were enrolled, no workflows were published, and delivery was not
activated. GoHighLevel was not called. The local `sa360` database had zero
`ClientGhlDestination` rows and zero `GhlLocationConfigSnapshot` rows.

Sam's annotated workflow image was not in this run's workspace, the repository,
or a Gmail search for a recent workflow attachment. The three mapping arrows
below are the task statement. They were checked against code. They were not
read off a screenshot.

Labels: **Observed** means the repository or the local database shows it.
**Unverified** means live GHL, a missing image, or an empty local database
still has to confirm it.

## 1. Findings

### Trace

| Step | Observed behavior | Owner |
| --- | --- | --- |
| Source payload | LeadCapture intake writes `WebhookRequestLog`, then `SourceLeadEvent`. Intake does not call GHL. | `apps/api/src/routes/webhook-leadcaptureio.ts`, `source-lead-intake.service.ts` |
| Normalization | Alias registry plus scoped funnel bindings. `branch`, `Branch of Service` → `branch_of_service`. `Desired Coverage`, `coverage_amount` → `desired_coverage`. `coverage_reason` → `primary_reason`. Keys stay distinct. | `source-field-alias.registry.ts` |
| Stored lead | Canonical answers live on `sourceAttributes`. DOB and age projection for new intake is `projectCampaignDobAge` (already on master). | `source-attribute-stamp.service.ts`, `campaign-dob-age.ts` |
| COC mapping | Operator map `ClientGhlDestination.sourceAttributeFieldMapJson` is canonical key → discovered GHL field id. Route override wins when present. The UI saves by key, not by row index. | `ghl-field-coverage.ts`, `ghl-walkthrough-panel.tsx` |
| GHL contact write | `POST /contacts/upsert` with `locationId`, `source: "sa360"`, and only non-empty email, phone, first name, last name. Native `state` is hard-coded `null` on the preview, so it is omitted. Native `dateOfBirth`, postal code, and timezone are not on this body. Custom fields are a later `PUT /contacts/{id}`. | `ghl-delivery-request-builders.ts`, `ghl-live-canary-executor.service.ts` |
| Workflow entry | A separate step after tags, opportunity, and owner. See the mode table. | `ghl-workflow-trigger-mode.ts`, executor |
| Timezone | SA360 does not write native `Timezone` or `sa360_timezone`. Onboarding can store a workflow whose name is exactly `select time zone` and enroll it with `direct_api`. The workflow itself is GHL-owned. | `onboarding-ghl-workflow.ts` |
| Follow-up | M2B Timing Gate, M2C cadence, and M2D AI Handoff are names in the 2026-05-08 screenshot registry. This repo does not enroll those workflows and does not set their window fields. | `docs/registry/sa360-workflows.csv` |

`client_contact_created` is an internal SA360 lifecycle row written after a successful upsert. It is not a GHL workflow trigger.

### The three mapping arrows

| Reported arrow | What the code does | Verdict |
| --- | --- | --- |
| `desired_coverage` → Branch of Service | Stamp reads `sourceAttributes.desired_coverage` and writes the field id stored under that key. Sam's Test field planner targets the name "Desired Coverage Range" and refuses a field whose name contains "coverage amount". | **Observed:** no code permutation. **Unverified:** a saved map or a GHL workflow action can still point this key at Branch of Service. That map is not in git, and the local database is empty. |
| `branch_of_service` → Primary Reason | Same key-addressed stamp. Planner matches "branch of service" and rejects "military status". It does not match "Primary Reason". | Same split. The alias `branch` → `branch_of_service` does not retarget Primary Reason. |
| `primary_reason` → Primary Reason | Planner and sheets header both use Primary Reason. `primary_reason` is not copied into `primary_concern`. | **Observed** as the intended contract. `coverage_reason` is an alias of `primary_reason`, so a question titled that way is stored as the reason, not as coverage. |

Sheets header "Desired Coverage" uses source field `coverage_amount`. The campaign row fills that cell from `lead_details.coverage_amount`, then `desired_coverage`. That is a column-name difference, not a write onto Branch of Service.

### Modes

Contact creation and workflow enrollment are different steps.

| Mode | Ongoing association path | If the executor runs |
| --- | --- | --- |
| `direct_api` | Allowed when a workflow id is saved and the destination is activated. | `POST /contacts/{contactId}/workflow/{workflowId}` with no JSON body. `locationId` is used only to pick the OAuth token. Does not add `SA360::TRIGGER::NEW_LEAD`. HTTP 422 is skipped when workflow start is optional, and fails the run when `workflowStartRequired` is true. |
| `tag_trigger` (database default) | Allowed when a workflow id is saved. The id is not sent to GHL. | Second `POST /contacts/{id}/tags` with `SA360::TRIGGER::NEW_LEAD`, plus `SA360::DATA::PARTIAL`, `SA360::DATA::MAPPING_REVIEW`, and `SA360::TRIGGER::AI_READY` when enrichment says so. Workflow HTTP call count is zero. |
| `none` | **Observed:** activation and ongoing delivery stop with `workflow_required` before any GHL write. | **Observed:** the executor still upserts the contact, stamps fields, and posts routing tags, then skips only `start_workflow`. Operator and fulfillment callers can reach that function. |

All three executor paths post routing tags first: niche, source, `SA360::EVENT::LEAD_CREATED`, and the client tag. `none` does not suppress that tag. A GHL workflow listening for contact creation or `SA360::EVENT::LEAD_CREATED` can still start. Whether the live VET workflow does that is **unverified**.

Opportunity failure skips both `tag_trigger` and `direct_api`. The contact and earlier stamps can already have succeeded. The run is then held.

### Missing values

**Observed:** empty and whitespace custom-field values are omitted from `PUT` bodies (`buildCustomFieldsForPutFromMap`, `buildTypedCustomFieldStampPlan`, `buildSourceAttributeStampPlan`). Mapped keys with no lead value are recorded as `missingSourceKeys` and are not sent. Upsert identity fields are omitted the same way, except `locationId` and `source`.

**Unverified:** whether GHL merges that `PUT` or replaces the contact's custom-field set. This code never sends an empty string to clear a field. If GHL treats a partial `customFields` array as the full set, omitted keys would clear. That was not tested live.

### Duplicates, tags, retry, re-entry

| Topic | Observed | Unverified |
| --- | --- | --- |
| Duplicate contact | SA360 does not search GHL before `POST /contacts/upsert`. Match material is email and/or phone on that body. Internal duplicate risk can skip the run (`duplicate_blocked`). A prior succeeded, partial, executing, or skipped-duplicate run is held. | GHL's own email/phone match and merge rules. |
| Existing tags | Delivery never reads tags and never deletes tags. It only `POST`s a tag list. | Whether GHL dedupes an existing tag or stores a second copy. |
| HTTP retry | `ghlLiveJson` retries 429, 5xx, and transport errors once (two attempts). Other 4xx, including workflow 422, are not retried. | |
| Outbox retry | A failed run is retried on the same row only when no step shows an external call. Any HTTP evidence holds the run so a contact is not upserted again. A contact that exists without enrollment is not automatically re-enrolled. | |
| Contact-created enrollment | Internal event name only. | A published GHL "Contact Created" trigger on M1A or BOT-1. The May 2026 registry says M1A's trigger is a new lead/contact/form trigger. That screenshot is not a current workflow export. |
| Downstream re-entry | Same idempotency key holds a second SA360 execution. | A contact update can still re-enter a GHL workflow whose trigger is contact changed. |

### `inboundWebhookRequest`

**Observed:** the identifier `inboundWebhookRequest` does not appear in this repository. `deliverGhlInboundWebhookFromIntake` is named only to assert that captured-test delivery does not call it. `webhook.generic.v1` validates an endpoint URL and has no `deliver` implementation. Production GHL writes on master go through the location API (`ghlLiveJson`).

**Unverified:** every `{{inboundWebhookRequest.*}}` reference inside the VET / LAL AI BOT-1 workflow. Those references get no body from the current API-first path. The annotated image was the intended inventory and was not available to this run.

### DOB boundary

Do not reimplement historical DOB repair. Master already has alias recovery, the scoped page registry, `projectCampaignDobAge`, and the `IncomingDobCorrectionAudit` table (PRs #260, #265, #269, #271, #272, #274, #275). Open PR #267 (`cursor/dob-historical-correction-156d`) still owns the 1,015-row writer. Its production apply rolled back; merging that PR does not fill old rows. This contract does not add a second writer, a second registry, or a replay of contacts already delivered.

**Observed delivery behavior:** when a lifecycle payload is present, a mapped `date_of_birth` stamp is `YYYY-MM-DD` from `projectCampaignDobAge`. A missing or invalid DOB is omitted. The contact upsert does not set native GHL Date of Birth.

## 2. Canonical source-to-destination contract

Intended contract. The stamp writes whatever field id is saved. It does not check the GHL display name.

| Source key | Stored key | Intended GHL name | Sheets v3 header | Missing value |
| --- | --- | --- | --- | --- |
| `branch`, `Branch of Service` | `branch_of_service` | Branch of Service | Branch of Service | Omitted from stamp. Blank sheet cell. |
| `desired_coverage`, `Desired Coverage`, `coverage_amount` | `desired_coverage` | Desired Coverage Range (Sam's Test create name). Not Branch of Service. | Desired Coverage, via `coverage_amount` | Omitted from stamp. Blank sheet cell. |
| `primary_reason`, `Primary Reason`, `coverage_reason` | `primary_reason` | Primary Reason. Not Primary Concern. | Primary Reason | Omitted from stamp. Blank sheet cell. |
| `military_status` | `military_status` | Military Status | Military Status | Omitted |
| `marital_status` | `marital_status` | Marital Status | Marital Status | Omitted |
| `sex` (`gender` is not an alias) | `sex` | Sex | Sex | Omitted. Sam's Test create may reuse a TEXT field named Gender. |
| `best_time_to_call` | `best_time_to_call` | Best Time to Call | Time to Call | Omitted |
| `beneficiary` | `beneficiary` | Beneficiary | Beneficiary | Omitted |
| `date_of_birth`, scoped `date` / `date_copy` | `date_of_birth` | Mapped custom field. Native Date of Birth is not written by upsert. | DOB (`YYYY-MM-DD`, calendar date not shifted) | Omitted. Age does not invent a birthday. |
| `age` | `age` / `consumer_age` | Mapped custom Age field. Native Age is not written by upsert. | Age | Omitted when no stored age and no usable DOB. |
| `applied_for_other_insurance` | `applied_for_other_insurance` | No default GHL name in code. Registry display name: `vot - applied for other insurance` (Webform Data, screenshot inventory). | No v3 column | Not in the COC survey list, so it stamps only if an operator adds it to the map. |
| `disability_rating` | `disability_rating` | Operator map | Disability Rating | Omitted |
| `fbclid`, `ad_id`, `ad_name`, `adset_id`, `adset_name`, `parent_url` | same | Not in the survey stamp unless mapped | Not copied into the onboarding Q&A note | Omitted |
| `sa360_lead_uid` and other `sa360_*` logical keys | routing / lifecycle | `stamp_custom_fields`, separate from survey answers | — | Omitted when unmapped or blank |
| email, phone, names | plan contact fields | Native contact fields on upsert | identity columns | Omitted when blank. `source` is always `sa360`. |
| `state` | stored contact state | Native State is not sent (preview `state` is null). | State | Sheet uses the stored value. GHL native State stays untouched by this upsert. |
| timezone | not set by delivery | Native Timezone and `sa360_timezone` are GHL workflow fields (M2B reads `sa360_timezone` in the registry). | — | SA360 does not send or clear them. |

Attribution custom fields (`sa360_*` UTM and campaign keys) ride `stamp_custom_fields`. Questionnaire answers ride `stamp_source_attributes`. Those are two `PUT`s.

## 3. Location, snapshot, and workflow inventory

No live GHL export was taken. Local snapshots: 0.

| ID or name | Role | Status |
| --- | --- | --- |
| `yCziKRW26eFg8IXAQZ73` | `SAM_TEST_GHL_LOCATION_ID`. Survey text fields may be created only here. | **Verified in source.** Not confirmed as the BOT-1 production location. |
| `d4c1fa4c-a3e2-4fd8-9091-b3fad0d04edd` | Workflow id used by tests and the walkthrough fixture. | **Test fixture.** Not a verified Select Time Zone or BOT-1 id. |
| `QBIEpeXqzvF2JAmbBSIR` | Pipeline id in the same tests. | **Test fixture.** |
| `b5b3729f-d3ae-4185-84c4-2d0dc3417e81` | Pipeline stage id in the same tests. | **Test fixture.** |
| `VPuMIhN6JpxdoXvvlekZ` | Direct-demo location allowlist in `direct-demo-delivery-config.ts`. | **Demo allowlist.** Not the VET contract location. |
| `select time zone` | Exact workflow name for onboarding discovery. The id is stored per client on `destinationWorkflowIdGhl`. | **Name verified. Id unverified** (no row in local DB, no constant). |
| `LAL AI BOT-1` | Named in the task. | **Absent from the repo.** Id unverified. |
| `M1A - New Lead Intake - Veteran` through `M3V-*` | Screenshot inventory `ghl_screenshot_inventory_2026_05_08`. | **Names only.** No workflow UUIDs. Published/draft and enrolled counts in that CSV are from May 2026 screenshots. |
| `GhlLocationConfigSnapshot` | Table can store `workflowsJson`, `customFieldsJson`, `tagsJson`. | **Schema only.** Zero local rows. No snapshot asset id in git. `snapshotInstalled` is a boolean, not an id. |
| Webform field display names (`vet - desired coverage`, `vet - branch of service`, `Vet - Primary Reason`, `vot - applied for other insurance`, native Date of birth, native Timezone) | `docs/registry/sa360-fields.csv` | **Names only.** No custom-field UUIDs. |

## 4. API-first design and retained webhook requirements

API-first shape, using the existing location-API executor rather than a second client:

1. Upsert the contact with identity only (`POST /contacts/upsert`). Add native `state` only if product decides the current omission is wrong.
2. Stamp survey answers, DOB, age, and attribution with the two existing `PUT`s. Resolve ids from the saved map. Do not create fields on a client location from this path. Sam's Test field creation stays limited to `yCziKRW26eFg8IXAQZ73`.
3. Enroll with `direct_api` only: `POST /contacts/{contactId}/workflow/{workflowId}` and no body. Do not also add `SA360::TRIGGER::NEW_LEAD` on that path. Adding both enrolls twice if the workflow trigger is the tag.
4. Treat `tag_trigger` as a legacy bridge: it proves a tag was posted, not that BOT-1 or Select Time Zone started.
5. Keep `none` as "do not enroll". Ongoing activation already refuses it. A later change should also refuse routing-tag side effects when the caller only wanted a contact, or document that `SA360::EVENT::LEAD_CREATED` is still applied.
6. Do not post an inbound-webhook body from intake. `inboundWebhookRequest` stays empty on this path.

Retained legacy webhook requirements, until a GHL export shows each one is gone:

- Any BOT-1, M1A, or follow-up step that reads `{{inboundWebhookRequest.*}}` still needs a webhook body. The location API does not provide one.
- A Contact Created or Contact Tag trigger on `SA360::EVENT::LEAD_CREATED` still fires when the executor posts that tag, including before a `direct_api` enroll.
- `tag_trigger` still requires a published GHL trigger on `SA360::TRIGGER::NEW_LEAD` ("Contact Tag Added"). The saved workflow id is not used.
- M2B still reads `sa360_timezone` and the text-window fields. API enroll of Select Time Zone does not fill those fields.
- Native Date of Birth, if a workflow reads the standard field rather than the mapped custom field, stays empty.
- `webhook.generic.v1` remains a readiness flag only. It is not a delivery implementation.

## 5. File ownership for Agents A, B, and C

Lanes follow `docs/development/PARALLEL_AGENT_WORK.md`. Schema changes stay with Auth/Account. PR #267 stays with the DOB agent.

| Agent | Lane | Owns | Must not |
| --- | --- | --- | --- |
| A | Ingestion | `apps/api/src/services/source-intake/` aliases, normalizer, and stamp **inputs**. New VET aliases only inside `source-field-alias.registry.ts`. | Historical DOB writer, `IncomingDobCorrectionAudit`, a second DOB registry, GHL HTTP, COC components. |
| B | Delivery (Ingestion-owned adapter; do not fork it) | `ghl-live-canary-executor.service.ts`, `ghl-delivery-request-builders.ts`, `ghl-workflow-trigger-mode.ts`, `source-attribute-stamp.service.ts`, `onboarding-ghl-workflow.ts`. Separate enroll from contact upsert. Keep `direct_api` body empty. | Replaying delivered contacts for DOB. Creating fields outside Sam's Test. Calling `deliverGhlInboundWebhookFromIntake`. Editing `ghl-live-transport.ts` retry semantics unless the task says so. |
| C | Quality for Admin C.O.C. mapping UI | `ghl-walkthrough-panel.tsx`, `ghl-field-coverage.ts`, `source-field-mapping-section.tsx`. Show the GHL field **name** next to the saved id for `desired_coverage`, `branch_of_service`, and `primary_reason`. | Inventing a backend write. Changing Prisma. Reordering save keys in a way that changes stored ids. Portal routes. |

Dependencies:

- C cannot correct a live swap until someone reads `sourceAttributeFieldMapJson` for the VET client. That JSON is not in git.
- B cannot prove BOT-1 enrollment until the workflow id is discovered and saved. Name match exists only for `select time zone`.
- A must leave PR #267's 1,015-row apply alone. Forward delivery already projects DOB at stamp time when the stored payload has a canonical birthday.
- Auth/Account is the only lane that may add a migration. This contract does not need one.

## 6. Test cases and open decisions

Existing tests to keep green, not to weaken:

- `ghl-workflow-trigger-mode.test.ts` — default `tag_trigger`; `none` and `direct_api` pass through.
- `ghl-live-canary-executor.test.ts` — `tag_trigger` adds the trigger tag and performs zero workflow HTTP calls; `direct_api` enrolls without a `locationId` body.
- `sam-test-survey-text-fields.test.ts` — the three keys plan onto three different names.
- `onboarding-ghl-workflow.test.ts` — Select Time Zone name match is unique, missing, or ambiguous.
- `ghl-recorded-source-stamp.test.ts` — mapped DOB/age omitted when missing.
- Captured-test assertion that `deliverGhlInboundWebhookFromIntake` is not called.

Cases not covered, for the implementation agents:

1. A destination map that points `desired_coverage` at a field named Branch of Service is visible in COC before save, and is rejected or explicitly confirmed.
2. `direct_api` does not post `SA360::TRIGGER::NEW_LEAD`. `tag_trigger` does not call `/workflow/`. `none` on the ongoing path performs zero GHL writes.
3. A blank `primary_reason` does not send `field_value: ""` and does not clear a previously stamped Primary Reason. State this as an omit. Add a live check only if product wants clear-on-blank.
4. Upsert body has no `dateOfBirth` and no `state` with the current builders. Change the assertion if product decides to send native state.
5. Opportunity failure leaves `workflowStarted` false even when the contact id exists, and the outbox disposition is `hold`.
6. `applied_for_other_insurance` stays unstamped when it is absent from `CANONICAL_SURVEY_ATTRIBUTES` and absent from the saved map.
7. Same email and phone on a second plan does not call upsert again when the first run succeeded.

Open product decisions:

1. Which published workflow is BOT-1, and what is its id? Select Time Zone is the only name the onboarding code matches.
2. Should VET enrollment be `direct_api` into that id, or remain `tag_trigger`?
3. Does contact creation also enter M1A? If yes, `direct_api` into BOT-1 double-enters unless M1A's trigger is removed or guarded.
4. Which steps still read `inboundWebhookRequest`? Those steps keep a webhook until they read contact fields.
5. Should a missing answer omit, send blank, or clear the GHL field?
6. Should native Date of Birth and native State be written, or only mapped custom fields?
7. Who sets `sa360_timezone` and native Timezone: Select Time Zone inside GHL, or SA360 before enroll?
8. Is `applied_for_other_insurance` in the VET workflow, and which GHL field (`vot - applied for other insurance` versus a newer name)?
9. After a partial run (contact saved, enroll failed), is the operator action "retry enroll only" or "hold forever"?
10. Historical DOB backfill stays on PR #267. This contract does not reopen it.
