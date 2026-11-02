# Client-scoped person dedupe before Sheets delivery

Policy id: `client_normalized_phone_email_v1`. Channel on every decision row: `sheets`.

This gate answers a different question from event idempotency and from GHL delivery. A repeated event is still one `CompanySheetsDispatchIntent` (`campaign:{client}:{sourceLeadEventId}`) and one lead `CompanySheetsDeliveryJob` (`lead:{client}:{event}`). A person is one normalized phone or one normalized email inside one client. A channel receipt stays on the job or on `GhlAssociationDispatchOutbox`. Sheets success does not write the GHL outbox and does not write `BuyerDeliveredIdentity`.

## What was already true

Same-event protection was already durable. `sheetsEventWriteDisposition` blocks the other path when a job for that event has succeeded, written rows, or started an append. A known pre-send failure (`status = failed`, `appendStartedAt` null, `rowsWritten = 0`) stays retryable on that same key. An uncertain, running, or succeeded job holds the other path. That guard does not look at a different event.

Duplicate-risk assessment (`evaluateDuplicateRisk`) reads `InboundContactIndex` for phone and email inside a client and subaccount. A name match is `possible_duplicate` and does not block live delivery unless an operator marks `same_person` on an already likely or source duplicate. `likely_duplicate`, `source_duplicate`, and `orphan_appointment` block live delivery unless the operator marks `separate_person` or `ignored_test`. Sheets delivery does not write `InboundContactIndex`. The index also requires a subaccount key (empty string allowed) and an E.164 phone. A sheets-only client, an email-only lead, and a phone that never reached the index are outside that check.

The missing-assessment path is a verified nonblocking fallback for routing and GHL, not an untested hypothesis. `routing-dry-run.service.ts` catches an assessment exception so routing still succeeds, and records `DuplicateRiskAssessmentFailure` with `failureClass` `transient` or `review`. `missingPersistedDuplicateAssessmentSummary()` still returns `blocksDelivery: false` with the message "No duplicate risk assessment persisted." How often production assessments fail was not measured. The Sheets gate does not trust that fallback.

`CompanySheetsDeliveryRow` is unique per spreadsheet, worksheet, and stable row id. Moving a campaign tab can allow another append of the same stable id. Person history therefore does not live on the tab.

Setting `SourceLeadEvent.status` to `duplicate_blocked` would also suppress GHL, because both recorders require `routing_matched`. Sheets holds are intent statuses only: `duplicate_held`, `review_held`, `assessment_held`, `assessment_failed`. The ordinary drain claims `pending`, `scheduled`, `retryable`, and campaign `awaiting_setup`. It does not claim those four hold statuses. A separate pre-pass, `recoverDueSheetsPersonHolds`, re-evaluates only transient assessment failures and partial history holds, then the same drain may enqueue the promoted intent once.

## Historical lookup

The first gate read the oldest 500 eligible lead jobs (`kind = lead`, excluding the current event and known pre-send failures) and treated `jobs.length >= 500` as incomplete. A genuinely new person was `review_held` / `delivery_history_incomplete` solely because the client had at least 500 prior eligible jobs, even when none of those jobs shared a phone or email. A duplicate that lived only in job 501 or later was held as incomplete. It was not admitted, and it was not matched. The sample length was not proof that history had ended.

That scan is gone. Eligible lead jobs are indexed into `ClientSheetsPersonAdmission` with `origin = delivery_index`. Eligible means `succeeded`, `uncertain`, `failed` with `appendStartedAt` or `rowsWritten > 0`, or `running` with `appendStartedAt`. Queued, retryable, and running jobs that have not started an append are not eligible. A `failed` job with no append and `rowsWritten = 0` is not eligible and is not a historical delivery. A succeeded job is stored `admitted`. Any other eligible job is stored `reserved`, with evidence `jobId`, `spreadsheetId`, `worksheetId`, and `jobStatus`. An existing identifier owner is not overwritten. The same event that owns the indexed row is `replay_allowed`, not a duplicate of itself. The index is client-scoped, not tab-scoped.

`prepareClientSheetsHistoryBaseline` and the gate itself advance one batch under the client advisory lock. `SHEETS_HISTORY_BATCH_LIMIT` is 500. The cursor is `(createdAt, id)`. One batch is a few queries, not one query per job.

`ClientSheetsHistoryCoverage` stores `status` (`unavailable`, `partial`, or `complete`) and `completenessProof` (`not_started`, `cursor_open`, `cursor_exhausted`, or `no_eligible_jobs`). `indexedCount` and `observedJobCount` are counters only. `readClientSheetsHistoryCoverage` downgrades a stored `complete` row when an eligible job still exists after the cursor. A count of 999 with a job still past the cursor is `partial` / `cursor_open`.

A new person is `review_held` when the batch cannot exhaust eligible jobs:

- 501 prior eligible jobs, batch 500, identifier not already owned: `history_coverage_partial`. Nothing is reserved.
- Exactly 500 prior eligible jobs fit one batch, `moreRemain` is false, and the person is admitted.
- A matched identifier is a duplicate decision, including while coverage is still partial, once that job has been indexed. It is not a coverage hold and it is not an admit.
- Zero eligible jobs is `complete` / `no_eligible_jobs` without a stored row. The first gate call on a client whose remaining jobs fit in one batch indexes them and can admit.

`history_coverage_partial` and `history_coverage_unavailable` are resumed by the drain pre-pass, which runs one more baseline batch and then the gate. Later leads are not left held after the cursor is exhausted, and they are not admitted while a batch remains. This change does not call the baseline at startup and does not import production history.

## Gate

`evaluateClientSheetsPersonGate` runs inside `recordCompanySheetsCampaignIntent` after the dispatch flag, routing status, client switch, cutoff, and tab readiness checks, and inside `enqueueConfirmedLeadSheetsDelivery` after the same-event write short-circuit and before `createJob`. It also runs inside `sendCompanySheetsCapturedEventTestRow` after that same short-circuit and before the captured job is created. Flag-off intake writes neither an intent nor a decision.

Normalized phone uses `tryNormalizeToVerifiedE164` (10-digit US becomes `+1…`). Email uses `normalizeEmail` (trim, lower case, must contain `@`). The values are the ones `campaignLeadIdentityFromPayload` would write. A name is never an identifier. No normalized phone and no normalized email is `review_held` / `no_normalized_phone_or_email`.

The check takes `pg_advisory_xact_lock(hashtextextended('client_sheets_person:' || client, 0))` for the caller's transaction, advances one history batch, then classifies from admission rows. The unique key `(clientAccountId, kind, normalizedValue)` is the durable backstop. A live reservation is `reserved` until a lead job succeeds, then `admitted`. A second event that finds one foreign owner is `duplicate_held`. `delivery_index` and `sheets_delivery_job` owners use reason `sheets_delivery_already_recorded`. A live reservation or Zap baseline uses `normalized_identifier_already_admitted`. Phone owned by one person and email owned by another is `review_held` / `shared_identifier_conflict`. The blocked event does not take either identifier. Deleting the job does not delete the indexed admission.

A missing assessment is `assessment_held` / `assessment_missing` when the lead has a routing decision and neither an assessment nor a failure marker. A failure marker and no assessment is `assessment_failed`. `failureClass = transient` uses reason `assessment_failed_transient`. Any other failure uses `assessment_needs_review`. No routing decision (writer tests, direct scheduling) is `not_applicable`; only phone and email apply. `possible_duplicate` does not block. `likely_duplicate` / `source_duplicate` / `orphan_appointment` block through `applyOperatorOverrideToLiveBlock` and do not reserve. `separate_person` and `ignored_test` do not block.

Every outcome writes `ClientSheetsDedupeDecision` (`sheets:{client}:{event}`) with policy, reason, normalized phone and email, assessment state, and prior evidence. History evidence includes `historyCoverage`, `completenessProof`, the two counts, and `countsAreNotProof: true`. Re-recording an `assessment_held` or `assessment_failed` intent may promote it. Other existing intent statuses are left as they are. The status API returns intent `status`, `reason`, and `lastError`, and the operator copy fields described below. `lastError` remains the gate code (`assessment_missing`, `assessment_failed`, `person_duplicate`, `person_review`).

`noteSheetsPersonDelivery` runs after a lead job finishes `succeeded` or `uncertain`, and after an operator release resolves an uncertain lead job to `succeeded`. Succeeded updates `origin = live_reservation` to `admitted`. Uncertain keeps `reserved` and stores the job id, spreadsheet, and worksheet. Errors are logged and swallowed so a successful append is not reopened.

Synthetic internal pilot leads (`isCompanySheetsInternalPilotLead`, route key `company_sheets_internal_pilot`) return `exempt_synthetic_pilot` before the assessment check so a pilot decision without an assessment can still be `pending`. `isSyntheticCampaignTestEvent` (id or `sourceLeadId` `synthetic-campaign-test`) is refused by captured send before the gate.

## Recoverable assessment failures

`recoverClientSheetsPersonHold(db, sourceLeadEventId, actor, now)` updates the same campaign intent. It does not create a job, append a row, or write the GHL outbox.

- Drain actor retries only `assessment_failed` + `assessment_failed_transient`, and `review_held` + `history_coverage_partial` or `history_coverage_unavailable`.
- Operator actor can also retry `assessment_needs_review` and `assessment_held` / `assessment_missing`.
- A review-class failure, or a payload that does not parse as a lifecycle event, stays `assessment_needs_review`. The evaluator is not called for an unparseable payload.
- A transient throw during retry sets `availableAt` 30 seconds ahead and stays `assessment_failed_transient`.
- When an assessment row exists and the gate admits, the same intent becomes `pending` with reason `person_hold_recovered`. A second call sees `pending` and returns `promoted: false`. The drain may then schedule that intent and clear the reason. The scheduled row is not labeled recovered and is not delivered.
- `processDueCompanySheetsDispatches` runs `recoverDueSheetsPersonHolds` first, then the normal claim loop. With execution off, the promoted intent is enqueued with `scheduleWithoutExecution` and marked `scheduled`. A second drain does not create a second job. Google is not called until execution is on.

`classifyAssessmentFailure` marks `PrismaClientInitializationError`, `PrismaClientRustPanicError`, `TimeoutError`, Prisma codes `P1001`, `P1002`, `P1008`, `P1017`, `P2024`, and connection-reset or timeout messages as `transient`. Everything else is `review`.

## Known-dead pre-send reservations

`releaseKnownDeadSheetsPersonReservation` runs under the same client lock. It releases only `origin = live_reservation` rows that are still `reserved`. Each released row is copied to `ClientSheetsPersonRelease` with reason `known_dead_presend_released`, and the decision is updated to `reservation_released` / `known_dead_presend_released`. The active admission rows are then deleted.

The release is refused when any job for that event is `uncertain`, has `appendStartedAt` set, or has `rowsWritten > 0` (`uncertain_append_held`). It is also refused when any job is not a conclusive pre-send failure (`delivery_not_conclusively_unsent`), including `queued`, `running`, `retryable`, and `succeeded`. No jobs, or only pre-send failures, may be released. A concurrent matching gate serializes on the lock, so one of the two owns the phone afterward. An uncertain append stays reserved until it is reconciled.

## Setup tests and jobs created before this migration

`sendCompanySheetsCapturedEventTestRow` now calls the person gate for a real client lead. A captured onboarding test that already wrote the event, followed by `enqueueConfirmedLeadSheetsDelivery` for that same event, returns the existing `campaign_test` job and does not append again. A second source event with the same normalized phone or email is `person_duplicate` and does not append. Setup tests do not bypass person admission for real client leads.

Preserved isolated synthetic tests:

- `synthetic-campaign-test` is refused before the gate.
- Internal pilot route keys stay `exempt_synthetic_pilot` and do not take a reservation.
- `enqueueOnboardingCapturedTestJob` remains the isolated onboarding worksheet path. Its idempotency key is `onboarding-test:{testRunId}:sheets`, and it is not a campaign lead job. Aged release and canary still do not call the gate.

`executeCompanySheetsDeliveryJob` re-checks admission for `kind = lead` after the custom-writer check and before the worksheet lock or any Google call. `leadJobMayAppend` allows the job when that event already has a `reserved` or `admitted` row. Otherwise it calls `evaluateClientSheetsPersonGate`. `history_coverage_partial`, `history_coverage_unavailable`, and `assessment_failed_transient` return the claim to `queued` with no Google call. Any other hold becomes `failed`, `lastError` set to the gate code, `appendStartedAt` null, and `rowsWritten` 0. That failure is a conclusive pre-send result and is not indexed as a delivery. A job that is already `uncertain` returns `uncertain` before the claim and is not reclassified as safe to retry.

Turning off new intent creation does not stop this path. Turning execution off returns before the guard, so it also does not rewrite existing jobs. The guard runs only when execution is on. Aged release, canary, and the controlled campaign and onboarding test bypasses do not call it.

`planPreMigrationLeadJobQuarantine` still only lists jobs. The result is `{ strategy: "quarantine_until_reconciled", ran: false, jobs }`. It does not update jobs or call Google. The enforceable stop is the execute guard, not that list. Operators can still read the list before turning execution on. The rollout is in `docs/validation/sheets-setup-integration.md`.

## Contact index writers and readers

Writers of `InboundContactIndex`:

- `upsertFromLifecyclePayload` from `routes/webhook.ts`, `action-dashboard-action.service.ts`, and `google-sheet-lead-intake.service.ts`
- `upsertFromGhlFallback` from `inbound-contact-index.service.ts` (Synthflow inbound lookup)

Readers: duplicate-risk correlation, Synthflow inbound and outbound lookup, and dashboards. The Sheets person gate does not read or write the index. `BuyerDeliveredIdentity` is a PPL post-success receipt, unique per client and event, and requires an allocation. `BuyerExternalDeliveryReceipt` is aged spreadsheet import, not Zap campaign history. Neither is the Sheets person ledger.

## Enqueue paths

Gated: `enqueueConfirmedLeadSheetsDelivery`, including admin `POST` lead delivery and the dispatch drain for `campaign_lead`, and `sendCompanySheetsCapturedEventTestRow`. The same-event short-circuit still returns before the gate, so an already written campaign test for that event is not turned into a person block.

Not gated:

- `enqueueAuthorizedAgedReleaseSheetsDelivery` and explicit aged schedule
- `enqueueCompanySheetsCanary`
- `enqueueOnboardingCapturedTestJob` (isolated onboarding worksheet key)
- synthetic internal pilot exemption
- `executeCompanySheetsDeliveryJob` for aged, canary, and controlled test jobs

Lead execution is gated. See the section above.

The worker only asks the API to drain. It is not a second writer.

## Verified Zap baseline

`importVerifiedZapSheetsBaseline` is an in-process function. No HTTP route, webhook, or startup call imports it. Callers that mention it are the gate, its unit test, and its integration test. It does not call Zapier and does not change live Zaps.

An operator exports Zap history and verifies it outside SA360, then passes records `{ importKey, phone, email, verifiedAt, evidenceRef }`. A row is skipped when the date does not parse, `evidenceRef` is shorter than 3 characters, or `importKey` is blank or longer than 160 characters. A name-only row is skipped and does not block. A verified row inserts `origin = historical_baseline`, `status = admitted`, key `zap:{client}:{importKey}`. The same key with the same identifiers is `alreadyPresent` and is not rewritten. The same identifier owned by another key or event is `conflicts` and is not overwritten. The returned object counts only the records submitted to that call. It is not proof that every historical sheet row was included. Sheet-job completeness is `ClientSheetsHistoryCoverage.status` plus `completenessProof` after the remaining-job probe. This change does not run an import.

## Display for Agent B

`getCompanySheetsDispatchStatus` returns each intent's `status`, `reason`, and `lastError`, plus `headline`, `detail`, `delivered`, and `recovered` from `companySheetsIntentOperatorCopy`. `lastError` is the gate code. Do not describe `indexedCount` or a Zap coverage count as proof that all history was included. History completeness is not on this status payload; it lives on `ClientSheetsHistoryCoverage`.

| status | reason | Display |
| --- | --- | --- |
| `duplicate_held` | `normalized_identifier_already_admitted` | Duplicate hold. This phone or email is already reserved or admitted for the client. |
| `duplicate_held` | `sheets_delivery_already_recorded` | Duplicate hold. A prior Sheets delivery owns this phone or email. |
| `duplicate_held` | `assessment_blocks_live_delivery` | Duplicate hold. The duplicate-risk assessment blocks live delivery. |
| `review_held` | `shared_identifier_conflict` | Needs review. The phone and email belong to different people. |
| `review_held` | `no_normalized_phone_or_email` | Needs review. No usable phone or email. |
| `review_held` | `history_coverage_partial` | Waiting on history. Indexing is in progress. The drain resumes it. |
| `review_held` | `history_coverage_unavailable` | Waiting on history. Indexing has not finished. The drain resumes it. |
| `assessment_held` | `assessment_missing` | Assessment missing. The drain does not retry it. An operator can re-evaluate after the assessment exists. |
| `assessment_failed` | `assessment_failed_transient` | Transient assessment failure. The drain retries it. |
| `assessment_failed` | `assessment_needs_review` | Assessment needs an operator. The drain does not retry it. |
| `pending` | `person_hold_recovered` | Recovered from a hold. Waiting to schedule. Not delivered. |
| `pending` | null or any other reason | Waiting to schedule. Not recovered and not delivered. |
| `scheduled` | null | Scheduled. A job exists. Execution has not delivered a row. Not recovered. |
| `scheduled` | `append_outcome_unresolved` | Scheduled, append outcome unknown. Not delivered and not safe to retry as a new row. |
| `completed` | null | Sheets job succeeded. This is the only delivered state in this copy. |

`companySheetsIntentOperatorCopy` is the wording used by `getCompanySheetsDispatchStatus` and the Google Sheets admin panel. `recovered` is true only for `pending` plus `person_hold_recovered`. `delivered` is true only for `completed`. `scheduled` is never delivered.

Operator recovery is `POST /admin/v1/clients/:clientAccountId/google-sheets/person-holds/:sourceLeadEventId/recover` with the admin key. The lead must belong to that client. It calls `recoverClientSheetsPersonHold` with actor `operator`, does not call Google, and returns `googleCalled: false` plus the same headline. The panel button is "Re-evaluate hold".

Known-dead release is `POST /admin/v1/clients/:clientAccountId/google-sheets/person-reservations/:sourceLeadEventId/release`. It calls `releaseKnownDeadSheetsPersonReservation`. An uncertain append returns `uncertain_append_held` and stays reserved. The panel button is "Release known-dead reservation". The actor header is `x-sa360-admin-actor`.

A pending `GhlAssociationDispatchOutbox` row means Sheets did not settle GHL. It is channel independence. It is not deduplicated GHL delivery. GHL still follows the older duplicate-risk and contact-index policy, which misses sheets-only clients, email-only leads, and phones that never reached the index.

## Proven guarantees

| Guarantee | Evidence |
| --- | --- |
| Repeated delivery of the same event does not create a second reservation or a second lead job | Gate replay; enqueue `created: false` |
| Same person, new event and new source, is `duplicate_held` after phone or email normalization | Integration: punctuation vs 10-digit phone, mixed-case email, distinct `sourceProvider` |
| Concurrent matching submissions leave one phone reservation | Two transactions, advisory lock, codes `admitted` and `person_duplicate` |
| Another client's same phone and email is admitted | Cross-client count of the normalized phone is 2 |
| Sheets-only history does not depend on GHL or the contact index | Gate never reads those tables; an indexed delivery on another worksheet still blocks |
| A tab change does not erase person history | Indexed uncertain job on worksheet 3 still matches after the contract moves to worksheet 9; deleting the job leaves the `delivery_index` admission |
| Shared phone/email split is review; shared name is not a block | Integration |
| Missing assessment is `assessment_held` and a review-class failure is `assessment_needs_review`; GHL outbox can still be pending | Integration; routing summary stays nonblocking |
| A transient assessment failure is retried by the drain into one scheduled job, and a second drain does not add a job | Integration, execution forced off, GHL outbox count 0 |
| An operator can promote `assessment_needs_review` and `assessment_held` after an assessment exists, once, through the same intent | `recoverClientSheetsPersonHold`, then one job from the drain |
| The drain does not promote a review-class assessment failure | Intent stays `assessment_failed` and job count stays 0 |
| 501 prior jobs hold a new person; an inflated `indexedCount` stays `partial`; exhausting the cursor then admits and blocks the indexed phone | Integration with `historyBatchSize: 2` |
| The production drain batch of 500 indexes 501 succeeded jobs to completion, schedules one new person without calling it delivered, and stops the phone that sat outside the first batch | Integration through `processDueCompanySheetsDispatches`, execution off |
| The same indexed event is `replay_allowed`. A conclusive pre-send failure and a queued job are not historical deliveries | Same drain test |
| A known-dead pre-send reservation can be released while another matching submission arrives, and an uncertain append cannot | Concurrent transactions; release audit rows kept; uncertain code `uncertain_append_held` |
| A captured onboarding test and a later campaign enqueue of the same event append once; a second real lead with the same phone does not append | Custom-writer integration |
| `likely_duplicate` blocks without a reservation; `separate_person` admits | Integration |
| Known pre-send failure retries the same event and blocks the next event | Reservation remains; failed job with no append is excluded from indexing |
| Append that succeeds and then times out stays reserved, then becomes admitted only after operator reconciliation to success | Delivery integration `throw-after-write-blind`, then release |
| Sheets success does not settle GHL | Outbox remains `pending` after `noteSheetsPersonDelivery` |
| Dispatch flag off writes nothing | Intent count 0 and decision count 0 |
| Verified Zap import is idempotent, skips name-only and unverified rows, and blocks a later live lead | Per-call counts plus a live gate match on `historical_baseline` |
| Queued lead jobs with no admission are listed and left queued | `planPreMigrationLeadJobQuarantine` returns `ran: false` |
| Aged, canary, the onboarding append module, and the GHL outbox do not call the gate. Lead execution does, through `leadJobMayAppend` | Source guard in the unit test. Captured send does call it |

## Remaining gaps

- GHL person dedupe is unchanged. A pending GHL outbox proves the Sheets hold did not suppress GHL. It does not prove GHL deduplicated the person.
- Aged release, canary, `enqueueOnboardingCapturedTestJob`, and the synthetic pilot do not pass the person gate.
- The quarantine planner remains read-only. Lead execution now refuses an unadmitted job. That guard exists only in this code. A process that already passed the execution-off check can still finish a write, so execution has to be off, and in-flight lead runs have to finish, before this build is the only writer. See `docs/validation/sheets-setup-integration.md`.
- An identifier on a blocked duplicate is not merged onto the winning person.
- Invalid or short phones are not identifiers. Two such leads match only when the email normalizes to the same value.
- A name alone never blocks.
- Missing-assessment routing and GHL stay nonblocking. The drain retries only `assessment_failed_transient` and partial history holds. `assessment_missing` and `assessment_needs_review` wait for `recoverClientSheetsPersonHold` with actor `operator`.
- No production migration, baseline import, historical replay, or delivery activation is included. Local databases received the additive migration `20261102190000_client_sheets_person_recovery` only so tests could run. Zap import runs only when an operator calls it with records already verified outside SA360.

## Migrations

- `20261102180000_client_sheets_person_admission` — `DuplicateRiskAssessmentFailure`, `ClientSheetsPersonAdmission`, `ClientSheetsDedupeDecision`.
- `20261102190000_client_sheets_person_recovery` — `failureClass` and `updatedAt` on the failure table, `ClientSheetsHistoryCoverage`, `ClientSheetsPersonRelease`. Additive.
- `20261102200000_client_sheet_header_literal` — header snapshots may contain empty strings. The migration does not rewrite cells. U+200B stays U+200B. The sentinel writer was not on master. Apply it after the two person migrations, and only after the execution-window queries in `docs/validation/sheets-setup-integration.md` are empty.
