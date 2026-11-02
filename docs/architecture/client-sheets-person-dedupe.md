# Client-scoped person dedupe before Sheets delivery

Policy id: `client_normalized_phone_email_v1`. Channel on every decision row: `sheets`.

This gate answers a different question from event idempotency and from GHL delivery. A repeated event is still one `CompanySheetsDispatchIntent` (`campaign:{client}:{sourceLeadEventId}`) and one lead `CompanySheetsDeliveryJob` (`lead:{client}:{event}`). A person is one normalized phone or one normalized email inside one client. A channel receipt stays on the job or on `GhlAssociationDispatchOutbox`. Sheets success does not write the GHL outbox and does not write `BuyerDeliveredIdentity`.

## What was already true

Same-event protection was already durable. `sheetsEventWriteDisposition` blocks the other path when a job for that event has succeeded, written rows, or started an append. A known pre-send failure (`status = failed`, `appendStartedAt` null, `rowsWritten = 0`) stays retryable on that same key. An uncertain, running, or succeeded job holds the other path. That guard does not look at a different event.

Duplicate-risk assessment (`evaluateDuplicateRisk`) reads `InboundContactIndex` for phone and email inside a client and subaccount. A name match is `possible_duplicate` and does not block live delivery unless an operator marks `same_person` on an already likely or source duplicate. `likely_duplicate`, `source_duplicate`, and `orphan_appointment` block live delivery unless the operator marks `separate_person` or `ignored_test`. Sheets delivery does not write `InboundContactIndex`. The index also requires a subaccount key (empty string allowed) and an E.164 phone. A sheets-only client, an email-only lead, and a phone that never reached the index are outside that check.

The missing-assessment path is a verified nonblocking fallback for routing and GHL, not an untested hypothesis. `routing-dry-run.service.ts` catches an assessment exception so routing still succeeds, and now records `DuplicateRiskAssessmentFailure`. `missingPersistedDuplicateAssessmentSummary()` still returns `blocksDelivery: false` with the message "No duplicate risk assessment persisted." How often production assessments fail was not measured. The Sheets gate does not trust that fallback.

`CompanySheetsDeliveryRow` is unique per spreadsheet, worksheet, and stable row id. Moving a campaign tab can allow another append of the same stable id. Person history therefore does not live on the tab.

Setting `SourceLeadEvent.status` to `duplicate_blocked` would also suppress GHL, because both recorders require `routing_matched`. Sheets holds are intent statuses only: `duplicate_held`, `review_held`, `assessment_held`, `assessment_failed`. Those statuses are not drained. `pending`, `scheduled`, `retryable`, and campaign `awaiting_setup` still are.

## Gate

`evaluateClientSheetsPersonGate` runs inside `recordCompanySheetsCampaignIntent` after the dispatch flag, routing status, client switch, cutoff, and tab readiness checks, and inside `enqueueConfirmedLeadSheetsDelivery` after the same-event write short-circuit and before `createJob`. Flag-off intake writes neither an intent nor a decision.

Normalized phone uses `tryNormalizeToVerifiedE164` (10-digit US becomes `+1…`). Email uses `normalizeEmail` (trim, lower case, must contain `@`). The values are the ones `campaignLeadIdentityFromPayload` would write. A name is never an identifier. No normalized phone and no normalized email is `review_held` / `no_normalized_phone_or_email`.

The check takes `pg_advisory_xact_lock(hashtextextended('client_sheets_person:' || client, 0))` for the caller's transaction, then inserts `ClientSheetsPersonAdmission` rows. The unique key `(clientAccountId, kind, normalizedValue)` is the durable backstop. A reservation is `reserved` until a lead job succeeds, then `admitted`. A second event that finds one foreign owner is `duplicate_held`. Phone owned by one person and email owned by another is `review_held` / `shared_identifier_conflict`. The blocked event does not take either identifier. A lead job scan (kind `lead`, excluding the current event and known pre-send failures, oldest 500) supplies owners when no admission row exists yet. Evidence keeps `worksheetId`. The scan is not filtered by the current tab, so a tab change cannot hide a prior job. Deleting the job does not delete the admission. If the scan hits the 500 cap and no foreign owner was found, the result is `review_held` / `delivery_history_incomplete` and nothing is reserved.

A missing assessment is `assessment_held` only when the lead has a routing decision and neither an assessment nor a failure marker. A failure marker and no assessment is `assessment_failed`. No routing decision (writer tests, direct scheduling) is `not_applicable`; only phone and email apply. `possible_duplicate` does not block. `likely_duplicate` / `source_duplicate` / `orphan_appointment` block through `applyOperatorOverrideToLiveBlock` and do not reserve. `separate_person` and `ignored_test` do not block.

Every outcome writes `ClientSheetsDedupeDecision` (`sheets:{client}:{event}`) with policy, reason, normalized phone and email, assessment state, and prior evidence. Re-recording an `assessment_held` or `assessment_failed` intent may promote it. Other existing intent statuses are left as they are. Drain maps an enqueue refusal back onto the decision reason. The status API already returns intent `status` and `reason`. No new HTTP field was added.

`noteSheetsPersonDelivery` runs after a lead job finishes `succeeded` or `uncertain`, and after an operator release resolves an uncertain lead job to `succeeded`. Uncertain keeps `reserved` and stores the job id, spreadsheet, and worksheet. Errors are logged and swallowed so a successful append is not reopened. Known pre-send failure does not clear the reservation: the same event may retry; a different event may not. There is no operator release of a reservation.

Synthetic internal pilot leads return `exempt_synthetic_pilot` before the assessment check so a pilot decision without an assessment can still be `pending`.

## Contact index writers and readers

Writers of `InboundContactIndex`:

- `upsertFromLifecyclePayload` from `routes/webhook.ts`, `action-dashboard-action.service.ts`, and `google-sheet-lead-intake.service.ts`
- `upsertFromGhlFallback` from `inbound-contact-index.service.ts` (Synthflow inbound lookup)

Readers: duplicate-risk correlation, Synthflow inbound and outbound lookup, and dashboards. The Sheets person gate does not read or write the index. `BuyerDeliveredIdentity` is a PPL post-success receipt, unique per client and event, and requires an allocation. `BuyerExternalDeliveryReceipt` is aged spreadsheet import, not Zap campaign history. Neither is the Sheets person ledger.

## Enqueue paths

Gated: `enqueueConfirmedLeadSheetsDelivery`, including admin `POST` lead delivery and the dispatch drain for `campaign_lead`. The same-event short-circuit still returns before the gate, so an already written campaign test for that event is not turned into a person block.

Not gated, by policy:

- `enqueueAuthorizedAgedReleaseSheetsDelivery` and explicit aged schedule
- `enqueueCompanySheetsCanary`
- `sendCompanySheetsCapturedEventTestRow` and `enqueueOnboardingCapturedTestJob`
- synthetic internal pilot exemption
- `executeCompanySheetsDeliveryJob` on a job that already exists

The worker only asks the API to drain. It is not a second writer.

## Verified Zap baseline

`importVerifiedZapSheetsBaseline` is an in-process function. No HTTP route, webhook, or startup call imports it. Callers that mention it are the gate, its unit test, and its integration test. It does not call Zapier and does not change live Zaps.

An operator exports Zap history and verifies it outside SA360, then passes records `{ importKey, phone, email, verifiedAt, evidenceRef }`. A row is skipped when the date does not parse, `evidenceRef` is shorter than 3 characters, or `importKey` is blank or longer than 160 characters. A name-only row is skipped and does not block. A verified row inserts `origin = historical_baseline`, `status = admitted`, key `zap:{client}:{importKey}`. The same key with the same identifiers is `alreadyPresent` and is not rewritten. The same identifier owned by another key or event is `conflicts` and is not overwritten. The returned coverage object counts records, phones, emails, either identifier, name-only skips, unverified skips, imported rows, identifiers admitted, already present, and conflicts. That object is the coverage proof. This change does not run an import.

## Proven guarantees

| Guarantee | Evidence |
| --- | --- |
| Repeated delivery of the same event does not create a second reservation or a second lead job | Gate replay; enqueue `created: false` |
| Same person, new event and new source, is `duplicate_held` after phone or email normalization | Integration: punctuation vs 10-digit phone, mixed-case email, distinct `sourceProvider` |
| Concurrent matching submissions leave one phone reservation | Two transactions, advisory lock, codes `admitted` and `person_duplicate` |
| Another client's same phone and email is admitted | Cross-client count of the normalized phone is 2 |
| Sheets-only history does not depend on GHL or the contact index | Gate never reads those tables; a delivery job on another worksheet still blocks |
| A tab change does not erase person history | Uncertain job on worksheet 3 still matches after the contract moves to worksheet 9; deleting the job leaves the admission |
| Shared phone/email split is review; shared name is not a block | Integration |
| Missing assessment is `assessment_held` and failed assessment is `assessment_failed`; GHL outbox can still be pending | Integration; routing summary stays nonblocking |
| `likely_duplicate` blocks without a reservation; `separate_person` admits | Integration |
| Known pre-send failure retries the same event and blocks the next event | Reservation remains; failed job with no append is excluded from the scan |
| Append that succeeds and then times out stays reserved, then becomes admitted only after operator reconciliation to success | Delivery integration `throw-after-write-blind`, then release |
| Sheets success does not settle GHL | Outbox remains `pending` after `noteSheetsPersonDelivery` |
| Dispatch flag off writes nothing | Intent count 0 and decision count 0 |
| Verified Zap import is idempotent, skips name-only and unverified rows, and blocks a later live lead | Coverage counts plus a live gate match on `historical_baseline` |
| Aged, canary, captured test, and GHL outbox do not call the gate | Source guard in the unit test |

## Remaining gaps

- A later GHL delivery for the same person still follows the old duplicate-risk and contact-index policy. This gate does not suppress it.
- Aged release, canary, captured onboarding test, and the synthetic pilot do not pass the person gate. Executing a job that was already created does not re-check.
- There is no operator action to release a reservation after a known-dead pre-send failure.
- The delivery scan reads the oldest 500 lead jobs. At the cap, a new person is review-held rather than admitted. A match inside those 500 still blocks. Jobs older than this deploy are not backfilled into admissions; the scan is the only view of them.
- An identifier on a blocked duplicate is not merged onto the winning person.
- Invalid or short phones are not identifiers. Two such leads match only when the email normalizes to the same value.
- A name alone never blocks.
- Missing-assessment routing and GHL stay nonblocking. Nothing in the drain re-evaluates `assessment_held` or `assessment_failed`; a later `recordCompanySheetsCampaignIntent` can promote them.
- No production backfill, historical replay, or delivery activation is included. Zap import runs only when an operator calls it with records already verified outside SA360.
