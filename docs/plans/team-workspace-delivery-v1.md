# Team Workspace and configurable delivery v1

Implementation contract only. This document does not deploy, migrate, toggle a flag, merge or close a pull request, call Google, GoHighLevel, Meta, Resend, or any customer webhook, or write a production row.

GitHub status below was read from the GitHub API on Friday, November 6, 2026, after 4:46 PM ET. Re-check GitHub before acting on any open pull request. Do not trust an older copy of this section.

The client-notification correction in this revision supersedes the earlier internal-recipient wording. Where an older paragraph still names `SA360_DELIVERY_SUCCESS_NOTIFY_TO`, a global `DeliverySuccessNotificationCursor`, or one email per channel receipt, the correction sections win.

## Baseline

Authoritative baseline: `origin/master` of `BirdofRain/sa360`.

| Fact | Value |
| --- | --- |
| SHA | `6b9ba280f78bb2164273f71163bf351038e1018b` |
| Commit time | Friday, November 6, 2026, 3:24 PM ET |
| Subject | Merge pull request #286 from `cursor/source-resolution-review-692c` |
| Parent still on master | `48e5bf8fce6a4192c00040a6c07d2be52a950f91`, the merge of #283, Thursday, November 5, 2026, 8:36 PM ET |

#286 is a read-only Facebook Source Resolution review. It is on this baseline. Its files are protected with the rest of Meta and Facebook intake.

## What this contract is

A simplified internal Team Workspace for the existing Admin C.O.C. `ADMIN` session. It shows one client's setup request, the three delivery choices, and the receipts that already prove a successful delivery. It does not replace `ClientAccount`, the GHL writer, the company Sheets writer, routing, or the customer portal.

The three delivery choices are:

1. GoHighLevel location API, already implemented.
2. Company Google Sheets, already implemented.
3. An outbound custom HTTPS webhook, not implemented. The registered shadow adapter `webhook.generic.v1` is not that sender.

Successful-delivery notification is a client email. During Team Workspace onboarding, Matt, Aaron, or Alex have one choice for that client: notify this client when a lead is successfully delivered, on or off. The choice defaults off. Verified recipients, the email channel, templates, and other technical settings stay in Admin C.O.C. Email is the first channel. SMS is not part of v1. The notification is not an internal staff mailing list, not the customer "order is ready" email, and not the support-ticket email.

Contextual support tickets reuse `SupportTicket`. They attach non-secret ids from the workspace. They do not become a second ticket system.

## Protected surfaces

No assignment in this contract may edit these behaviors or their production configuration:

- Meta and Facebook intake, including `apps/api/src/routes/sources-facebook.ts`, `apps/api/src/lib/meta-webhook.ts`, `apps/api/src/services/source-intake/facebook-lead-normalizer.ts`, `facebook-capture-record.ts`, `facebook-form-association.ts`, and the #283 models `MetaGraphCredential`, `MetaPageCaptureGrant`, and `MetaFormCandidate`.
- Graph fetch and the Facebook Source Resolution review added by #286 (`admin-facebook-source-resolution.ts`, `facebook-source-resolution-review.ts`, and the admin page under `facebook-intake/source-resolution`).
- Source normalization, routing persistence, and `CampaignRoutingRule` / `SourceFunnel` association.
- The GHL live executor (`ghl-live-canary-executor.service.ts`, `ghl-live-canary.service.ts`, `association-ongoing-delivery.ts`, `ghl-association-dispatch.ts`) and `ClientGhlDestination` activation.
- The company Sheets writer (`company-sheets-delivery.service.ts`) and dispatch (`company-sheets-dispatch`).
- Payment, order approval, operator review, and `LeadDeliveryExportPackage.spreadsheetDeliveredAt`.
- Production flags already in use, including `SA360_GHL_ONGOING_DELIVERY_ENABLED`, the company Sheets flags, and the Meta capture flags. This contract does not turn them on or off.
- `ClientOnboardingSetup` as an operational switch. A setup choice remains a request.

## Pull request reconciliation

Confirmed with `gh pr view`. None of the open pull requests below should be merged or closed by this work.

| PR | GitHub state | Relation to this contract |
| --- | --- | --- |
| [#237](https://github.com/BirdofRain/sa360/pull/237) | Merged Tuesday, October 27, 2026, 3:53 PM ET as `72f2485c925ac6fd66407d48c42855d6561eac64` | On master. Admin C.O.C. Setup & Delivery workspace. Reuse it. Do not rebuild it. |
| [#283](https://github.com/BirdofRain/sa360/pull/283) | Merged Thursday, November 5, 2026, 8:36 PM ET as `48e5bf8fce6a4192c00040a6c07d2be52a950f91` | On master. Default-off Meta multi-Page capture. Protected. |
| [#285](https://github.com/BirdofRain/sa360/pull/285) | Merged Thursday, November 5, 2026, 11:48 AM ET as `6e36cad7ebdb1338c7f440f67daafba2dccc2794` | On master. LAL AI BOT-1 VET delivery defaults to Webform 8 and keeps resumed owners. |
| [#286](https://github.com/BirdofRain/sa360/pull/286) | Merged Friday, November 6, 2026, 3:24 PM ET as `6b9ba280f78bb2164273f71163bf351038e1018b` | Current master. Read-only Source Resolution review. Protected. |
| [#284](https://github.com/BirdofRain/sa360/pull/284) | Open, `mergeable=CONFLICTING`. Base is `cursor/vet-ghl-delivery-contract-0184`, not master. Head `5e4230309a11`, last updated Wednesday, November 4, 2026, 7:10 PM ET | Superseded by merged #285. Same twelve files, without the resumed-owner fix. Do not merge. |
| [#227](https://github.com/BirdofRain/sa360/pull/227) | Open draft. Base master. Head `f9c7e801db7e`, last updated Monday, October 26, 2026, 9:21 AM ET | Not on master. `ghl-inbound-workflow-delivery.ts` does not exist. It posts a matched lead to a GHL inbound workflow URL and edits `source-intake-routing-persist.ts`. That is not the outbound custom webhook. Do not merge. |
| [#207](https://github.com/BirdofRain/sa360/pull/207) | Open. Base master. Head `eec844956286`, last updated Wednesday, October 22, 2026, 8:36 AM ET | Superseded on master. `apps/admin-coc/src/lib/nav.ts` already documents the integration of #207 and #210 and splits Team and Admin Tools. Merging #207 would rewind the sidebar, including the #286 page-meta overlap. Do not merge. |
| [#238](https://github.com/BirdofRain/sa360/pull/238), [#239](https://github.com/BirdofRain/sa360/pull/239), [#241](https://github.com/BirdofRain/sa360/pull/241) | Open drafts. Base is `cursor/client-onboarding-v2-integrate-96e2`, not master | Stale stack. The GHL location test adapter, exact-v3 onboarding append, and captured-test wiring are already on master. Merging the stack would replay schema and writer edits. Do not merge. |
| [#245](https://github.com/BirdofRain/sa360/pull/245) | Open draft. Base master. Head `34a365c2a9c2`, last updated Tuesday, October 28, 2026, 7:15 PM ET | Stale against current master. `previewOnboardingStoredLeadAction` already exists. `column-map-stored-lead-preview.ts` does not. The diff edits the Setup & Delivery UI. Out of this contract. Do not merge. |
| [#267](https://github.com/BirdofRain/sa360/pull/267) | Open. Base master. Head `6d520c277fa1`, last updated Wednesday, November 4, 2026, 10:18 AM ET | Historical 1,015-row DOB apply script. Later DOB mapping pull requests are already merged. This one writes intake payloads. Out of scope. Do not merge and do not edit its files. |
| [#276](https://github.com/BirdofRain/sa360/pull/276) | Open. One validation doc. Head `4ac7b23a4d29` | The VET delivery behavior landed in #277 and #285. The audit doc is not on master and is not required here. Do not merge for this contract. |
| [#287](https://github.com/BirdofRain/sa360/pull/287) | Open. Its title says do not merge | Diagnostic workflow only. Leave it. |
| [#288](https://github.com/BirdofRain/sa360/pull/288) | Merged Friday, November 6, 2026 as `6332cdbbb29377978e5d12d0eaa28a2ac2a98bb7` | This contract's first revision. The internal-recipient wording in that revision is corrected below. |
| [#289](https://github.com/BirdofRain/sa360/pull/289) | Open. Base `master`. Head `edec097561d9d0bf257099e5a4007acb773d0141`. `mergeable=MERGEABLE`. Zero commits behind `6332cdbb` | Assignment 1 as opened. **Changes required. Do not merge.** Verdict below. |
| [#290](https://github.com/BirdofRain/sa360/pull/290) | Open. Base `master`. Head `cb5222d6d13bd5e30fb5f479aa6fd966852d6517`. `mergeable=MERGEABLE`. Zero commits behind `6332cdbb` | Assignment 2 as opened. **Changes required. Do not merge.** The planning gate can stay. The predicate cannot. Verdict below. |

## Existing versus missing

### Existing

| Capability | Source on this baseline | What it already does |
| --- | --- | --- |
| Administrative setup request | `ClientOnboardingSetup` and `ClientOnboardingSetupAuditEvent` | Draft and review metadata behind `SA360_NATIVE_CLIENT_SETUP_ENABLED`. `operational` is not a column. The service treats the row as a request. Routes: `GET` and `PATCH /admin/v1/clients/:clientAccountId/setup`. |
| Onboarding v2 profile | `ClientOnboardingDestinationProfile` | `ghlMode` of `unset`, `location_api`, `inbound_webhook`, or `external_zapier`. Sheets selection and note contract. It does not store tokens or a webhook secret, and it does not write `CompanySheetsDestination`. |
| Setup & Delivery UI | Merged #237, `apps/admin-coc/src/app/(dashboard)/clients/[clientAccountId]/onboarding/page.tsx` | Admin-only. Observer and portal sessions are rejected. Reads and actions stay on the existing onboarding routes. |
| Onboarding read and config API | `admin-client-onboarding-v2-read.ts`, `admin-client-onboarding-v2-ghl.ts`, `admin-client-onboarding-v2-config.ts`, `admin-client-onboarding-v2-test.ts` | Mounted at `/admin/v1`. Read flag `SA360_CLIENT_ONBOARDING_V2_READ_ENABLED` must be the exact string `true`. Config, captured test, custom writer, and Google-only pilot flags are separate and exact. |
| GHL delivery | `ClientGhlDestination`, `GhlLiveDeliveryRun`, `GhlLiveDeliveryStepRun`, `GhlAssociationDispatchOutbox` | Ongoing association delivery uses run mode `ongoing_association`. A selected test uses `paused_location_test`. The short canary uses `live_canary`. Service switch: `SA360_GHL_ONGOING_DELIVERY_ENABLED`. A client is authorized only when `deliveryEnabled`, `deliveryMode=live`, `clientCutoverApproved`, and `internalApprovalStatus=approved` match the saved location (`isPersistedLiveDestination`). |
| Company Sheets delivery | `CompanySheetsDestination`, `CompanySheetsTabContract`, `CompanySheetsDeliveryJob`, `CompanySheetsDeliveryRow`, `CompanySheetsDispatchIntent` | Campaign dispatch and aged dispatch default off. A job is `queued`, `running`, `succeeded`, `retryable`, or `uncertain`. Kinds include `lead`, `aged_release`, `canary`, `campaign_test`, and `onboarding_captured_test`. |
| Channel-neutral target | `DeliveryTarget` | Adapters registered for shadow validation include `ghl.crm.v1`, `webhook.generic.v1`, `google_sheets.v1`, and `google_sheets.company.v1`. LF2 planning excludes both Sheets keys. It does not exclude `webhook.generic.v1`. |
| Webhook shadow check | `delivery-adapter.registry.ts` | `webhook.generic.v1` is ready for shadow only when `configMetadataJson.endpointUrl` is non-empty. There is no execution adapter. `getExecutionAdapter("webhook.generic.v1")` is null, so a live attempt fails closed with `adapter_not_registered`. |
| GHL execution adapter | `execution-adapter.registry.ts` | Live execution exists for `ghl.crm.v1` on the LF2 path. That path is not the association `GhlLiveDeliveryRun` path. |
| Customer release email | `notifyCustomerDeliveryReleased` on `LeadDeliveryExportPackage` | One claim per export package after `spreadsheetDeliveredAt`. Status `pending`, `sending`, `sent`, `skipped`, or `failed`. Resend idempotency key `delivery-release:{exportId}`. This is the aged-order portal email. |
| Transactional email | `apps/api/src/lib/transactional-email.ts` | Resend HTTP. No send unless `RESEND_API_KEY` and `SA360_TRANSACTIONAL_EMAIL_FROM` are set. Optional `Idempotency-Key`. |
| Support tickets | `SupportTicket`, `/admin/v1/support-tickets`, Admin C.O.C. launcher | Admin API key. Categories include `DELIVERY` and `WEBHOOK`. The launcher stores page path, query ids, and an optional related entity. UI flag `NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED` defaults off. Ticket email is best-effort and defaults to `sam@lifeagentlaunch.com` unless disabled. |
| Admin roles | `ADMIN` and `SA360_OBSERVER` | Shared admin password session plus `x-sa360-admin-key`. Observer allowlist is exact paths, default deny. No per-person staff user, membership, or invite table exists. |
| Agent Workspace | `apps/api/src/routes/agent-workspace.ts`, `x-sa360-workspace-key` | A different product: the GHL embed for an agent. It is not the internal Team Workspace. |

### Missing

| Need | Gap on this baseline |
| --- | --- |
| Simplified Team Workspace | The sidebar group named Team is a list of existing admin pages. There is no single client delivery workspace beyond Setup & Delivery, and no route whose only job is the three destinations plus receipts. |
| Named staff identities | Roadmap stage 2 in `docs/roadmaps/native-client-onboarding.md` asks for invites for Matt, Aaron, and Alex. That is not this v1. v1 keeps the existing `ADMIN` session. |
| Outbound custom webhook | No sender, no signing secret store, no per-client arm that is separate from `DeliveryTarget.enabled`. An enabled `webhook.generic.v1` row would be eligible for LF2 `DeliveryInstruction`s today. |
| GHL inbound workflow webhook | Profile mode `inbound_webhook` exists. The poster in #227 does not. Onboarding readiness treats an enabled `webhook.generic.v1` row as `inboundWebhookArmed` and requires `ghl_webhook_stored_disabled` when any such row exists. |
| Canonical success read that matches production GHL | `findProductionGhlReceipt` accepts only `GhlLiveDeliveryRun.mode === "location_api"`. Production association runs are stored as `ongoing_association`. The helper's tests use `location_api`. Ongoing successes therefore do not satisfy onboarding `proofs.delivery` through that helper. |
| Client successful-delivery email | Nothing stores a per-client on/off preference, a verified client recipient, or one notification per client and source lead. Nothing scans qualifying Sheets and GHL receipts and sends the client one email. Support-ticket notify is not that email. Customer release notify is not that email. An internal `SA360_DELIVERY_SUCCESS_NOTIFY_TO` list is not that email. |
| Ticket context for a delivery receipt | The launcher can store a related entity when a caller passes one. Setup & Delivery and the future Team Workspace do not attach the job id or live-run id. |
| Exactly-once ticket email | Ticket create fires notify without a claim row. A retry of ticket create is a second ticket. That stays as it is. Delivery notification must not copy that pattern. |

## Source of truth

Use the row that already records the fact. Do not copy it onto the setup document or onto a new client registry.

| Fact | Source of truth | Not a source of truth |
| --- | --- | --- |
| Client identity | `ClientAccount.clientAccountId` | Setup JSON, a display name, a GHL location id |
| Setup request | `ClientOnboardingSetup` | `ClientOnboardingDestinationProfile`, a `DeliveryTarget` |
| GHL location, workflow, live arm | `ClientGhlDestination` | Profile `ghlMode`, a workflow id inside setup JSON |
| Onboarding destination choice | `ClientOnboardingDestinationProfile` | A live switch |
| Company spreadsheet and tabs | `CompanySheetsDestination` and `CompanySheetsTabContract` | `google_sheets.v1` `DeliveryTarget`, a pasted URL in setup JSON |
| Company Sheets send | `CompanySheetsDeliveryJob` and its rows | `spreadsheetDeliveredAt`, an onboarding test attempt |
| Company Sheets schedule | `CompanySheetsDispatchIntent` | The job alone |
| Association GHL send | `GhlLiveDeliveryRun`, its step runs, and `GhlAssociationDispatchOutbox` | `findProductionGhlReceipt` until it is taught the production mode, HTTP status alone |
| LF2 allocation delivery | `DeliveryInstruction` and `DeliveryAttempt` | Association GHL runs. v1 notifications do not use this path |
| Outbound custom webhook, once built | One `DeliveryTarget` with `adapterKey = webhook.generic.v1`, plus a new secret row. `enabled` stays false until the arming assignment | Profile mode `inbound_webhook`, #227, `configMetadataJson` secrets |
| Customer "order is ready" email | `LeadDeliveryExportPackage` notify columns | The client successful-delivery notification |
| Client notification preference | `ClientDeliveryNotificationPreference` | `ClientOnboardingSetup`, `portalLoginEmail`, a global env recipient, routing, `deliveryEnabled`, `campaignDispatchEnabled` |
| Client successful-delivery email, once built | One `DeliverySuccessNotification` per client and source lead | A channel receipt, Resend's response alone, one row per Sheets job or GHL run |
| Channel receipt evidence | `CompanySheetsDeliveryJob` and `GhlLiveDeliveryRun` (and a future webhook attempt) | The notification row. The scanner does not rewrite those receipts |
| Support ticket | `SupportTicket` | A delivery receipt or a client notification |
| Internal operational alert | Not this contract | `DeliverySuccessNotification` |

`validateDeliveryTargetMetadata` rejects keys that look like tokens, secrets, passwords, or credentials. The signing secret must not be stored in `configMetadataJson`. Onboarding audit SQL already rejects webhook URLs inside `metadataJson`. Do not put the endpoint URL in that audit or in a ticket.

## Canonical successful delivery

A channel receipt qualifies only for its own channel. Sheets success does not imply GHL success. GHL success does not imply Sheets success. An HTTP 2xx does not prove a contact, a workflow enrollment, a note, or a spreadsheet row. A test, preview, probe, or aged-release receipt never qualifies.

The notification decision is separate and is defined under "When a client notification qualifies." It waits until every armed destination for that client has a qualifying receipt for the same source lead.

### Company Sheets campaign lead

A company Sheets receipt qualifies only when all of the following are true:

- `CompanySheetsDeliveryJob.kind` is `lead`.
- `status` is `succeeded`.
- `rowsWritten` is at least 1.
- Every `CompanySheetsDeliveryRow` for that job has `status` `written`.
- `finishedAt` is set.
- The job `idempotencyKey` does not start with `onboarding-test:`.
- `clientAccountId` matches the destination and the dispatch intent.
- A `CompanySheetsDispatchIntent` exists with `kind` `campaign_lead`, the same `sourceLeadEventId`, `jobId` equal to this job when `jobId` is set, and `createdAt` greater than or equal to `CompanySheetsDestination.campaignDispatchNotBefore`.
- `sourceLeadEventId` is not `synthetic-campaign-test`.

`appendStartedAt` is not a success signal. `finishJob` in `company-sheets-delivery.service.ts` stores `finishedAt` on `succeeded` and sets `appendStartedAt` to null for every status other than `uncertain`. Requiring `appendStartedAt` on a succeeded job rejects the production receipt. Leave the writer unchanged. An `uncertain` job keeps `appendStartedAt` when the append had started, and that job is not success.

`findProductionSheetsDelivery` checks kind, status, client, cutoff intent, and the synthetic id. It does not load rows or `finishedAt`. The notification predicate is stricter than that helper. Do not treat the helper's job id as sufficient.

These are not campaign success: kind `canary`, `campaign_test`, `onboarding_captured_test`, or `aged_release`; status `queued`, `running`, `retryable`, or `uncertain`; a job whose append started and then became `uncertain`; a permission probe; a header write by itself; `spreadsheetDeliveredAt`; an `onboarding-test:` idempotency key.

Aged release stays on its own path. Its operator receipt is `spreadsheetDeliveredAt`. Its customer email stays `notifyCustomerDeliveryReleased`. This contract does not send a second email for that package.

### GoHighLevel location API

Production association runs are stored as mode `ongoing_association`. `findProductionGhlReceipt` still requires mode `location_api` and is not this predicate. Notification code must not call it. A later assignment may teach that helper the production mode. It must not start treating HTTP acceptance, test modes, or an unproven contact as success.

The live executor derives run status in `deriveLiveCanaryRunStatus`. Contact, tags, and a configured opportunity are the hard path. `assign_owner`, `start_workflow`, `stamp_custom_fields`, and `write_intake_summary_note` are optional post-contact steps. Any of those left `skipped`, `optional_failed`, `failed`, or `partial_success` makes the run `partial_success` even when the contact was upserted. The VET path records `assign_owner` as `skipped` when an existing owner is left unchanged. `outboxTerminalFromDelivery` then settles that run with `lastError` null. A predicate that accepts only `status = succeeded` misses those production deliveries. A predicate that accepts every `partial_success` would also accept a run whose required workflow did not enroll.

A GHL receipt qualifies only when all of the following are true:

- `GhlLiveDeliveryRun.mode` is `ongoing_association`.
- The contact operation from `separateDeliveryResults` is `upserted` or `replayed`.
- The contact step has a stored `vetOperationReceipt` with `operation` `contact`, `outcome` `completed`, and an external id. HTTP status, including 2xx, is not that receipt. A synthesized completed outcome from step status alone is not that receipt.
- No required operation on that run has outcome `ambiguous`, `rejected`, or `failed_before_send`. The required operations are contact, tags, a configured opportunity, and workflow when `ClientGhlDestination.workflowStartRequired` is true. The same three outcomes on an optional step do not by themselves disqualify the run.
- When `workflowStartRequired` is true, the workflow result is `enrolled` or `replayed` on a stored workflow receipt (`operation` `workflow`, `outcome` `completed`). A note id, a contact upsert, or an HTTP status is not enrollment.
- When `workflowStartRequired` is false, a missing, skipped, or `optional_failed` workflow does not disqualify the run.
- `ClientOnboardingDestinationProfile.notesEnabled` is not a delivery requirement. The writer turns notes on from `intakeSummaryNotesEnabled` on the destination field mapping or the source-enrichment policy, and a note step is never a hard failure. A missing note step does not disqualify the run. An ambiguous, rejected, or failed note does not disqualify a run that already met the required path above. A note id is not workflow proof.
- Run `status` is `succeeded`, or it is `partial_success` and every disqualifying check above is absent. `partial_success` caused by a skipped or optional owner assignment, an optional custom-field stamp, a note step, or a non-required workflow is still a qualifying contact delivery.
- The `GhlAssociationDispatchOutbox` row for that source lead is `settled`, `externalCallExecuted` is true, `lastError` is null, `liveRunId` is this run, and the client matches.
- The run idempotency key and every stored step receipt idempotency key do not start with `onboarding-test:`.
- No `ClientOnboardingTestAttemptKey` matches this run's contact, workflow, note, or sheets idempotency key. The pure predicate cannot query that table. The scanner must load the keys and pass them in. Omitting them is not a pass.

These do not qualify: mode `location_api`, `live_canary`, or `paused_location_test`; status `executing`, `failed`, or `skipped_duplicate`; `partial_success` or `succeeded` without a proven contact external id; a required workflow that is not enrolled; an outbox left `uncertain` or `executing`; an onboarding test attempt.

`deliveryRetryDisposition` still holds non-success runs. This contract does not change it.

### Outbound custom webhook

No qualifying webhook receipt exists on this baseline.

When a later assignment adds one, it qualifies only when all of the following are true:

- `SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED` and the per-client webhook `enabled` flag were both on before the send.
- The attempt row records `externalCallExecuted` true, a signed request, HTTP status 200 through 299, a redacted response, and `finishedAt`.
- The outcome is not a timeout, a redirect, a 4xx, or a 5xx.

That HTTP result proves the webhook call. It does not prove a GHL contact, a workflow, a note, or a Sheets row. A shadow validation of `endpointUrl` is not a receipt. `readinessStatus` `ready_for_shadow` is not a receipt.

### When a client notification qualifies

Armed destinations are operational rows. They are not `ClientOnboardingSetup` and not `destinationChoice`.

| Destination | Armed when |
| --- | --- |
| GoHighLevel | `isPersistedLiveDestination` is true for that client |
| Company Sheets campaign | `campaignDispatchEnabled` is true and `campaignDispatchNotBefore` is set |
| Custom webhook | `SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED` is the exact string `true` and `ClientCustomWebhookDestination.enabled` is true |

The notification preference does not arm or disarm any of these. While the webhook flag is unset, a webhook row is not an armed destination even if its own `enabled` column is true.

A source lead produces at most one client notification, and only when every destination that is armed at decision time has a qualifying receipt for that same `sourceLeadEventId`. If any armed destination is still `queued`, `running`, `retryable`, `uncertain`, or `executing` for that lead, or has failed its qualifying checks, insert nothing. The first channel to finish is evidence. It is not a send. If no destination is armed, insert nothing.

The qualifying completion time is the latest `finishedAt` or `completedAt` among the armed destinations' qualifying receipts. That time must be strictly after the client's `enabledAt`.

## Client notification preference

One row, `ClientDeliveryNotificationPreference`, per `clientAccountId`.

- `enabled` defaults false.
- `channel` is `email` in v1. Do not add `sms` until a later assignment implements SMS.
- `recipientEmail` is null until Admin C.O.C. saves one address. Normalize it to lowercase. One mailbox. No display name and no list.
- `recipientEmailVerifiedAt` is set in that same Admin C.O.C. save. This contract does not send a verification message. Verified means an admin recorded the address and the timestamp together. `portalLoginEmail` is not copied in.
- A check constraint requires `enabled` to stay false unless `recipientEmail`, `recipientEmailVerifiedAt`, and `enabledAt` are all present and `channel` is `email`.
- The enable transition sets `enabledAt` to the database transaction time. Callers cannot supply an earlier time. `enabledAt` never moves backward. Turning the preference off sets `enabled` false and sets `disabledAt`. It does not clear `enabledAt`. Turning it on again sets `enabledAt` to the new transaction time so the off gap is not backfilled.
- Changing the address clears `recipientEmailVerifiedAt`, sets `enabled` false, and does not move `enabledAt` backward. The client cannot be re-enabled until the new address is verified in the same way.
- Team Workspace cannot write the address, the channel, or a template. It can request on or off only. On is rejected with `recipient_not_verified` when the check would fail.
- The preference does not write `CampaignRoutingRule`, `ClientGhlDestination.deliveryEnabled`, `CompanySheetsDestination.campaignDispatchEnabled`, `DeliveryTarget.enabled`, or `ClientCustomWebhookDestination.enabled`.

`SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED` stays a process kill switch. Exact `true` is required before the scanner queries or sends. It does not enable any client, and it does not choose a recipient. Do not add `SA360_DELIVERY_SUCCESS_NOTIFY_TO`. There is no default recipient and no internal mailing list on this path.

## Exactly-once client notification

One email per client and source lead, including when GoHighLevel and company Sheets both receive that lead.

- Durable row `DeliverySuccessNotification`.
- `sourceLeadEventId` is required. Unique `(clientAccountId, sourceLeadEventId)`.
- Unique `idempotencyKey` is `client_lead:{clientAccountId}:{sourceLeadEventId}`.
- Nullable evidence columns `sheetsJobId`, `ghlLiveRunId`, and `customWebhookAttemptId` record the qualifying receipts. Filling the second id updates the same row. It does not insert another row and it does not send another email.
- The Sheets job, the GHL run, the outbox row, and a future webhook attempt stay the channel evidence. The scanner does not update their status.
- Status values: `pending`, `sending`, `sent`, `skipped`, `failed`. The same words as the customer release notifier. Do not add synonyms.
- The scanner inserts `pending` only in the transaction that decides every armed destination qualifies, the preference is enabled, the recipient is still verified, the global flag is exact `true`, and the qualifying completion time is strictly after `enabledAt`. A second insert for the same client and source lead is a no-op and does not reopen `sent`.
- The sender claims with a conditional update from `pending` or `failed`, or from `sending` older than 10 minutes, to `sending`. Claim count must be 1. `sent` and `skipped` are not claimable.
- Resend `Idempotency-Key` is that `idempotencyKey`, truncated to 256 characters, matching `sendTransactionalEmail`. The recipient is the verified preference address only.
- `sent` is terminal.
- `skipped` means the flag and the preference were on and the lead qualified, but `RESEND_API_KEY`, `SA360_TRANSACTIONAL_EMAIL_FROM`, or the verified recipient was missing at send time. The ordinary scan does not retry it.
- Email failure sets `failed` and does not change a delivery row.
- No row is inserted for a test, a preview, a probe, an uncertain job, an aged-release package, a lead that finished before `enabledAt`, or a lead whose required destination is still open or unqualified.
- The scanner does not call Google, GHL, Meta, or the customer webhook. It does not change job status, run status, routing, delivery activation, or `spreadsheetDeliveredAt`.
- Do not call `notifyCustomerDeliveryReleased` or `notifySupportTicketCreated` for this event.

Support-ticket email stays best-effort and separate. A ticket is not a client notification, and a client notification does not open a ticket. Internal operational alerts are not this row, not this scanner, and not this recipient. They need a separate authorization if they are ever built.

There is no `DeliverySuccessNotificationCursor`. Per-client `enabledAt` is the only eligibility clock. A global `armedAt` would notify deliveries that completed after the process flag flipped and before that client was enabled.

## Data and API contract

Closed vocabulary. Implement these strings.

### Flags

Every new flag defaults off. Only `trim()` equal to the exact string `true` enables it. `TRUE`, `1`, `yes`, and `on` stay off. That matches `SA360_CLIENT_ONBOARDING_V2_READ_ENABLED` (`trim() === "true"`). It is stricter than `SA360_GHL_ONGOING_DELIVERY_ENABLED`, which lowercases before the compare, and stricter than `NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED`, which treats `1`, `true`, `yes`, and `on` as on. Do not copy those looser parsers.

| Flag | Process | Default | Enables |
| --- | --- | --- | --- |
| `SA360_TEAM_WORKSPACE_ENABLED` | API | unset | `GET /admin/v1/team-workspace/clients/:clientAccountId` |
| `NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED` | Admin C.O.C. | unset | The nav item and the page shell. It does not authorize an API call. The public prefix is acceptable only because the API still checks the server flag and the admin session. |
| `SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED` | API | unset | Registration of a simulate-only adapter and, in a later assignment, a live POST. Off means `webhook.generic.v1` stays excluded from LF2 planning even if a row is `enabled`. |
| `SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED` | API | unset | Process kill switch for the scanner. Off means the scanner returns before a query and before Resend. It does not enable a client and it does not select a recipient. |

Do not add these flags to a production environment in the assignments below.

### Team Workspace read

`GET /admin/v1/team-workspace/clients/:clientAccountId`

- `clientAccountId` matches `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`.
- Flag off: `404` and `error: "team_workspace_disabled"`.
- Unknown client: `404` and `error: "client_not_found"`.
- Missing or wrong admin API key: existing `401` or `503` from `verifyAdminApiKey`.
- A portal key, a portal assertion, or `x-sa360-workspace-key` on the same request: `403` `forbidden`, the same `foreignCredential` rejection as onboarding v2 read.
- The Admin C.O.C. server calls this route only after `requireAdminCocAdminSession`. An observer session role `SA360_OBSERVER` never receives the admin key for this path. Do not add `/team-workspace` to the observer document or API allowlists. A literal cookie value of `observer` is not the session check. The signed role is.
- Postgres reads only. No Google, GHL, Meta, Resend, or webhook call.

```json
{
  "ok": true,
  "contractVersion": "team_workspace_delivery_v1",
  "client": {
    "clientAccountId": "alex_gross",
    "clientDisplayName": "Alex Gross",
    "status": "onboarding"
  },
  "setupRequest": {
    "present": true,
    "status": "draft",
    "revision": 1,
    "destinationChoice": "both",
    "operational": false
  },
  "destinations": {
    "ghl": {
      "configured": false,
      "deliveryEnabled": false,
      "deliveryMode": null,
      "locationIdPresent": false
    },
    "companySheets": {
      "configured": false,
      "campaignDispatchEnabled": false,
      "campaignDispatchNotBefore": null,
      "agedDispatchEnabled": false
    },
    "customWebhook": {
      "present": false,
      "enabled": false,
      "endpointHost": null
    }
  },
  "recentCanonicalDeliveries": [],
  "clientNotification": {
    "enabled": false,
    "canEnable": false,
    "blockedReason": "recipient_not_verified",
    "recipientVerified": false
  },
  "notifications": {
    "items": []
  }
}
```

`setupRequest.operational` is always false. `destinationChoice` is the setup JSON enum `ghl`, `google_sheets`, `both`, `intake_only`, or `undecided`. It is not the notification preference and it is not a delivery arm. `recentCanonicalDeliveries` uses the channel predicates in this document, at most 20 rows, newest first. Each item is `{ "channel", "receiptId", "sourceLeadEventId", "canonical", "at" }` with `channel` of `company_sheets` or `ghl_location_api`. Those rows are evidence. They are not one email each. `custom_webhook` appears only after that receipt exists. `endpointHost` is the hostname only.

`clientNotification` is the Team Workspace on/off choice. `enabled` defaults false. `canEnable` is true only when a verified email recipient exists. `blockedReason` is null or `recipient_not_verified`. The read does not include the address, a template, an SMS number, or the signing secret. Until the preference table is on master, the read returns this disabled object and does not query a missing table.

`notifications.items` is one row per source lead after the notification table exists: `{ "sourceLeadEventId", "status", "at", "sheetsJobId", "ghlLiveRunId", "customWebhookAttemptId" }`. It is empty before that. It is not one item per channel.

### Custom webhook configuration

Not in the first assignment. The later write, when authorized, is:

`PUT /admin/v1/team-workspace/clients/:clientAccountId/custom-webhook`

Body: `requestId` UUID, `expectedRevision`, `endpointUrl` (`https` only), `signingSecret` present on create, `enabled` default false. The secret is write-only. The response returns `endpointHost`, `secretFingerprint`, `enabled`, and `revision`. A conflict on revision is `409`.

Creating or updating this row does not set `DeliveryTarget.enabled`, `isPrimary`, or `isRequired` to true. It does not set `CompanySheetsDestination` dispatch flags or `ClientGhlDestination.deliveryEnabled`.

### Notification claim

No public send route. A worker function `scanCanonicalDeliveryNotifications` runs only when `SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED` is exact `true`. It then applies the per-client preference, `enabledAt`, and the all-armed-destinations rule. It inserts one `pending` row per qualifying client and source lead, then claims and sends. Tests call it with a fake `sendTransactionalEmail`.

The Team Workspace on/off write is not assignment 3. It is an Auth/Account route after the preference table exists: `PUT /admin/v1/team-workspace/clients/:clientAccountId/delivery-notification` with `requestId`, `expectedRevision`, and `enabled`. It rejects `enabled: true` with `recipient_not_verified` when the check would fail. It does not accept an email address. The recipient write is a separate Admin C.O.C. route, `PUT /admin/v1/clients/:clientAccountId/delivery-notification-recipient`, admin key, exact workspace flag, body `requestId`, `expectedRevision`, and `recipientEmail`. That route sets `recipientEmailVerifiedAt` and forces `enabled` false when the address changes. Neither route sends mail.

### Contextual ticket

No new ticket route. The workspace calls the existing `POST /admin/v1/support-tickets` through the existing server action.

`contextJson` may contain only:

```json
{
  "teamWorkspace": {
    "contractVersion": "team_workspace_delivery_v1",
    "clientAccountId": "alex_gross",
    "sourceLeadEventId": null,
    "sheetsJobId": null,
    "ghlLiveRunId": null,
    "customWebhookAttemptId": null
  }
}
```

`relatedEntityType` is one of `source_lead_event`, `company_sheets_delivery_job`, `ghl_live_delivery_run`, `custom_webhook_attempt`. `relatedEntityId` is that row's id. Category `DELIVERY` or `WEBHOOK`. No lead payload, phone, email, token, signing secret, or endpoint URL.

## Security and RBAC

v1 does not add a role, a staff user, a session cookie, or an invite.

| Caller | Team Workspace page | Team Workspace API | Ticket create | Webhook PUT | Notification scan |
| --- | --- | --- | --- | --- | --- |
| Admin C.O.C. `ADMIN` | Allow when the UI flag is exact `true` | Allow when the API flag is exact `true` and the admin key matches | Existing admin key | Later assignment, admin key, flag exact `true` | Not exposed |
| `SA360_OBSERVER` | Deny. Do not add the path to `OBSERVER_DOCUMENT_PATHS` | BFF returns 403 before the admin key is used. The path stays off the allowlist | Deny | Deny | Deny |
| Customer portal session | Deny | Deny | Deny | Deny | Deny |
| `x-sa360-workspace-key` | Deny | Deny | Deny | Deny | Deny |
| Anonymous | Redirect to login | `401` or `503` | `401` or `503` | `401` or `503` | Deny |

Observer denial is path-exact. A new `/team-workspace` page is denied because it is absent from the allowlist. Do not add a prefix rule. The later preference and recipient writes use the same admin key and the same observer denial. A portal session and `x-sa360-workspace-key` cannot call them.

The actor label on onboarding audit remains untrusted. It must not authorize the workspace.

Signing secrets use a new encryption key name, `SA360_CUSTOM_WEBHOOK_SECRET_KEY`. Do not reuse `META_TOKEN_ENCRYPTION_KEY` or the Google token key. Tests use a local fixture key. The ciphertext and the plaintext never go to logs, tickets, or `configMetadataJson`.

`endpointUrl` is stored for the sender and is not returned in full by the read API. Logs store the receipt id and the HTTP status.

## Migration plan

Only the Auth/Account assignment may add a migration, and only by amending the unreleased migration in #289. It is additive relative to current master. It does not edit a migration that is already on master. Agents run it only against local `127.0.0.1` databases. Merging it to master is a production schema change, as assessed below.

Models:

- `ClientCustomWebhookDestination`. Keep the #289 shape. One row per `clientAccountId`. Optional unique `deliveryTargetId` pointing at the `webhook.generic.v1` target. Columns: `endpointUrl`, `signingSecretCiphertext`, `signingSecretFingerprint`, `enabled` default false, `revision` default 1, timestamps. Deleting the client cascades this configuration row and does not send. Deleting the optional `DeliveryTarget` only nulls the pointer.
- `ClientDeliveryNotificationPreference`. One row per `clientAccountId`. Columns and the enable check are in "Client notification preference." Deleting the client cascades this configuration row and does not send.
- `DeliverySuccessNotification`. One row per client and source lead, as in "Exactly-once client notification." `ON DELETE RESTRICT` on `clientAccountId`. Evidence columns are nullable. Index `(status, claimedAt)` and the unique pair `(clientAccountId, sourceLeadEventId)`.
- Do not create `DeliverySuccessNotificationCursor`.

No change to `CompanySheetsDeliveryJob`, `GhlLiveDeliveryRun`, `SourceLeadEvent`, `MetaPageCaptureGrant`, `ClientOnboardingSetup`, or `LeadDeliveryExportPackage`.

`DeliveryTarget.enabled` for `webhook.generic.v1` stays false in this migration. Do not backfill enabled rows. Do not insert a preference with `enabled` true. Do not insert notification rows.

The SQL file is hand-written. Prisma 6.19 on the `sa360-migrate` path sends it with `simple_query` and does not add `BEGIN` or `COMMIT`. The file must open with `BEGIN`, set `SET LOCAL lock_timeout = '3s'`, and end with `COMMIT`, matching `docs/operations/historical-catalog-summary-schema-v1.md`. The `sa360_app` grant block stays inside that transaction: `SELECT`, `INSERT`, `UPDATE`, `DELETE` on the three tables, skip with a notice on loopback when the role is absent, and raise on any other host when the role is absent. Do not change default privileges, create a role, or set a password.

`getClientDeletionImpact` must count `DeliverySuccessNotification` rows and block deletion while any exist, so `deleteClientAdmin` returns `CLIENT_HAS_DEPENDENCIES` instead of a foreign-key error. It must not delete those rows. Webhook and preference rows are configuration and cascade only when a deletion is already allowed.

Apply with `pnpm exec prisma migrate deploy` on the local `sa360` and `sa360_test` databases, then run it again and confirm a no-op. Do not run migrate against a remote database. A local no-op is not production readiness. See the review verdict.

Until that migration is on master, the other lanes do not query the new models. They stop at the dependency instead of creating a second table from application code.

### Production migration readiness

Not ready in the #289 migration as opened. A local `prisma migrate deploy` on `127.0.0.1` does not prove production readiness.

`docs/deploy/digitalocean-app-platform.md` and `docs/validation/sheets-setup-integration.md` describe the live path: App Platform `deploy_on_push` runs job `sa360-migrate` as `PRE_DEPLOY` with `pnpm migrate:deploy`. That job applies every pending migration before traffic switches. A non-zero exit leaves the previous deployment serving. Merging a migration to `master` therefore applies it to production on the next API deploy. There is no feature flag around DDL.

The opened file creates two enum types, three tables, foreign keys, a cursor insert, and the grant, with no `BEGIN`/`COMMIT`. A statement failure after `CREATE TYPE` or `CREATE TABLE` commits that DDL. Prisma records a failed migration. The retry is not idempotent, so the next deploy fails until someone resolves the failed row. This contract does not authorize that resolution.

The opened notification unique key is one row per channel receipt, and the cursor is a global clock. Shipping that shape and correcting it later is a second production migration against a table the pre-deploy job already created. Do not do that. Amend the unreleased file before merge.

After the amendment, the migration is the smallest production-safe schema change available: empty tables, no data rewrite, no update of a Sheets job or GHL run, grants in the same transaction as the tables, and a three-second lock timeout. The new foreign keys lock `ClientAccount` and `DeliveryTarget` only for the constraint check. Those tables are client configuration, not lead-event volume. That is the readiness bar. Meeting it still means the merge itself is the production apply. It is not a license to turn on a flag, send mail, or call a provider.

## Review verdicts for #289 and #290

Reviewed Friday, November 6, 2026, against `origin/master` `6332cdbbb29377978e5d12d0eaa28a2ac2a98bb7` and the opened heads. Neither pull request is merged by this contract. Neither may be merged as opened.

### #289 — changes required

Auth/Account. Head `edec097561d9d0bf257099e5a4007acb773d0141`. Do not merge until the migration is amended in place.

What can stay:

- `ClientCustomWebhookDestination`, cascade on the client, `ON DELETE SET NULL` on the optional target, `enabled` default false, no send relation.
- AES-256-GCM through `encryptAes256GcmToken`, key name `SA360_CUSTOM_WEBHOOK_SECRET_KEY` only. Fingerprint is a SHA-256 prefix and is not the secret. Ciphertext stays out of `configMetadataJson`, ticket context, and read metadata. `validateDeliveryTargetMetadata` rejects `signingSecret` and `signingSecretCiphertext`.
- `SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED` is on only when `trim()` is the exact string `true`.
- The claim update is one conditional `updateMany` from `pending`, `failed`, or `sending` older than 10 minutes. `sent` and `skipped` are not claimable. A unique-key conflict on insert does not reopen `sent`.
- The `sa360_app` grant matches the Meta capture and company Sheets grant pattern: explicit table grants, no default-privilege change, notice on loopback when the role is absent, exception otherwise.

What must change before merge:

- Replace the per-receipt idempotency key and the `DeliverySuccessChannel` row identity with one row per `(clientAccountId, sourceLeadEventId)` and the evidence columns in this contract.
- Remove `DeliverySuccessNotificationCursor`. Add `ClientDeliveryNotificationPreference` and its check constraint in the same unreleased migration.
- Wrap that SQL in `BEGIN` / `lock_timeout` / `COMMIT`.
- Count notification rows in `getClientDeletionImpact` and keep `ON DELETE RESTRICT`. The opened migration blocks `deleteClientAccountById` once a row exists, and the impact service does not know about the table, so an otherwise deletable client fails with a Prisma foreign-key error.
- Do not add `SA360_DELIVERY_SUCCESS_NOTIFY_TO`.

An additive follow-up migration is the wrong fix. The unique key and the cursor would already be on production, because merging #289 to master runs them in the pre-deploy job. Editing the unreleased file is the smallest change that avoids that second production DDL.

### #290 — changes required

Ingestion. Head `cb5222d6d13bd5e30fb5f479aa6fd966852d6517`. Do not merge until the predicate matches production receipts. The planning gate can stay.

What can stay:

- `isCustomWebhookDeliveryEnabled` is exact `true` only. `TRUE`, `1`, `yes`, and `on` stay off.
- While that flag is off, planning drops `webhook.generic.v1` before readiness, including when the target is enabled and required. `google_sheets.v1` and `google_sheets.company.v1` stay excluded. A `ghl.crm.v1` instruction is unchanged. No schema, no live POST, and `deliverLive` is still absent, so a flag that was turned on early would still fail closed at execution. This contract does not turn it on.
- HTTP 2xx is not treated as a GHL receipt. `location_api`, `live_canary`, `paused_location_test`, `partial_success` without a proven contact, ambiguous, rejected, and `failed_before_send` on a required operation are rejected. The predicate does not query or write. It does not edit the writers.

What must change before merge:

- A succeeded Sheets job with `appendStartedAt` null and `finishedAt` set must qualify when the other Sheets checks pass. An `uncertain` job with `appendStartedAt` set must not.
- `partial_success` must qualify when the required path in this contract passed, including the production case of a skipped `assign_owner` on an otherwise proven contact. It must not qualify when the contact receipt or a required workflow is missing.
- `ClientOnboardingDestinationProfile.notesEnabled` must not be required. A missing note step on a proven contact qualifies.
- A Sheets job idempotency key that starts with `onboarding-test:` must not qualify.
- Do not edit `company-sheets-delivery.service.ts`, the GHL executor, or `findProductionGhlReceipt` in that amendment.

### Merge order

1. This docs pull request. It does not migrate and it does not enable a flag.
2. Amended #289 and amended #290, either order, after this contract is on `origin/master`. Rebase each onto that master and re-run its tests. Do not batch-merge them.
3. Assignment 3 can start from this contract for the read-only shell. It returns the disabled `clientNotification` object until #289 is on master. It does not create a table.
4. Assignment 4 starts only under the conditions below.

### Assignment 4 start conditions

Start the Ingestion scanner and simulate-only webhook adapter only when all of the following are true:

- This corrected contract is on `origin/master`.
- Amended #289 is on `origin/master`, including the transactional migration, the preference check, the one-row-per-client-and-source-lead key, and the deletion-impact blocker.
- Amended #290 is on `origin/master`, including the production Sheets and GHL predicates.
- The branch is rebased onto that master and the assignment 2 and assignment 4 tests have been re-run there.
- `SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED` and `SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED` are unset.
- The scanner returns before a query when the notify flag is not exact `true`.
- The scanner inserts only after the preference is enabled, the recipient is still verified, completion is strictly after `enabledAt`, and every armed destination qualifies.
- One source lead that reaches both GHL and Sheets produces one `pending` row and one mailer call.
- Tests inject a fake fetch and a fake `sendTransactionalEmail`. `deliverLive` stays absent.
- The scanner does not call `findProductionGhlReceipt`, Google, GHL, Meta, Resend, or a customer host.

## Per-agent ownership and dependencies

Lanes are the ones in `docs/development/PARALLEL_AGENT_WORK.md`. Each assignment is one branch and one pull request. Rebase onto updated `origin/master` before merge. Do not batch-merge.

### Assignment 1 — Auth/Account, first

Schema and claim primitive only. No HTTP send. No route mount. No flag turned on. Amend #289 in place. Do not open a second migration for the preference.

Owns:

- `prisma/schema.prisma` for the webhook destination, the preference, and the notification row, and the one unreleased directory under `prisma/migrations/`
- `apps/api/src/lib/custom-webhook-secret.ts`
- `apps/api/src/lib/delivery-success-notification-env.ts`
- `apps/api/src/services/delivery-success-notification/notification-claim.ts`
- `apps/api/src/services/client/client-deletion-impact.service.ts`, limited to counting notification rows as a deletion blocker
- tests beside those files

The idempotency helper returns `client_lead:{clientAccountId}:{sourceLeadEventId}`. A second channel updates evidence columns. It does not insert a second row.

Does not own and must not edit: delivery planning, the GHL executor, the Sheets writer, Meta and Facebook files, admin nav, onboarding UI, `admin-auth.ts`, `workspace-auth.ts`, `client-portal-auth.ts`.

Depends on: this corrected contract on master.

Done when: the migration file contains `BEGIN` and `COMMIT`, local migrate applies twice, the enable check rejects a row with `enabled` true and a null recipient, two concurrent claims of one client-lead key yield one winner, a second channel does not create a second key, secret metadata is rejected by `validateDeliveryTargetMetadata`, client deletion impact blocks on a notification row, and `SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED` is off unless a test sets it.

The preference and on/off routes in "Notification claim" are a later Auth/Account change after this migration is on master. They still do not send. The Admin C.O.C. recipient form is Quality, and it waits on that route. It is not part of the Team Workspace page.

### Assignment 2 — Ingestion, parallel with assignment 1

Planning exclusion and the pure canonical predicate. No live HTTP. No schema edit.

Owns:

- `apps/api/src/services/delivery-success/canonical-delivery.ts`
- `apps/api/src/services/delivery-success/canonical-delivery.test.ts`
- `apps/api/src/services/fulfillment-shadow/delivery-planning.service.ts`, limited to excluding `webhook.generic.v1` unless `SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED` is exact `true`
- `apps/api/src/lib/custom-webhook-env.ts`, the flag function only: `trim() === "true"`
- a new planning test that an enabled `webhook.generic.v1` row creates no instruction while the flag is off, and that a `ghl.crm.v1` instruction is unchanged
- do not edit `apps/api/src/lib/google-sheets-env.ts`. Call `isGoogleSheetsLf2PlanningExcluded` as it is, and add the webhook exclusion beside it in `delivery-planning.service.ts`

Does not own: `company-sheets-delivery.service.ts`, `ghl-live-canary*.ts`, `source-intake/`, `sources-facebook.ts`, `prisma/schema.prisma`.

Depends on: this corrected contract. It does not depend on assignment 1. Amend #290 in place.

Done when: the predicate tests cover a succeeded Sheets job with `appendStartedAt` null, an `uncertain` job with `appendStartedAt` set, `ongoing_association` versus `location_api`, a `partial_success` run that qualifies because owner assignment was skipped, a `partial_success` run that does not qualify because the contact receipt is missing, a required workflow that was not enrolled, notes left off, an `onboarding-test:` Sheets key, and planning still excludes both Sheets adapter keys and `webhook.generic.v1` while the webhook flag is off.

### Assignment 3 — Quality, parallel with 1 and 2

Read-only Team Workspace shell. No new write. No migration.

Owns:

- `apps/admin-coc/src/app/(dashboard)/team-workspace/page.tsx`
- `apps/admin-coc/src/app/(dashboard)/team-workspace/[clientAccountId]/page.tsx`
- `apps/admin-coc/src/components/team-workspace/`
- `apps/admin-coc/src/lib/team-workspace/`
- `apps/admin-coc/src/lib/nav.ts`, one item behind `NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED`, added through the existing `visibleAdminNavItems` option pattern
- `apps/admin-coc/src/lib/page-meta.ts` only for the new href's title
- `apps/api/src/routes/admin-team-workspace.ts` and its test, mounted from `apps/api/src/app.ts` with a one-line register
- `apps/api/src/services/team-workspace/team-workspace-read.ts`

The API route lives in the Quality assignment because it is an admin read composed from existing repositories. It must not grow a write. If that file list collides with an Ingestion agent, Quality keeps the route and Ingestion does not edit `app.ts`.

Does not own: `setup-delivery-workspace.tsx`, onboarding routes, observer allowlist entries, portal files, Prisma.

Depends on: existing onboarding and destination reads. If `SA360_CLIENT_ONBOARDING_V2_READ_ENABLED` is off, the workspace still renders the client and shows onboarding as unavailable. It does not turn that flag on. Until assignment 1 is on master, `clientNotification` is the disabled object in the read contract and `notifications.items` is empty. The page does not query a missing table.

The page shows one choice: "Notify this client when a lead is successfully delivered," on or off. Off is the default. On cannot be selected when `canEnable` is false. The page does not collect an email address, an SMS number, a template, or a webhook secret, and it does not show those values. It points recipient setup at Admin C.O.C. The control does not change routing or delivery activation. Assignment 3 does not add the on/off write. The recipient editor is not on this page.

The support control on this page uses the existing `SupportTicketButton` with the context object in this contract. Build that context in `apps/admin-coc/src/lib/team-workspace/ticket-context.ts`. Do not change `capture-context.ts` except to call it.

Done when: flag off hides the nav item and the API returns `404` `team_workspace_disabled`; an observer receives `403` and is not added to the allowlist; the page renders from fixture JSON without a browser call to Google or GHL.

### Assignment 4 — Ingestion, after 1 and 2 are on master

Simulate-only webhook adapter and the notification scanner. Still no live POST to a customer host.

Owns:

- `apps/api/src/services/fulfillment-execution/custom-webhook-execution.adapter.ts`
- `apps/api/src/services/fulfillment-execution/execution-adapter.registry.ts`, register the adapter with `deliverLive` absent
- `apps/api/src/services/delivery-success-notification/scan.ts`
- tests that inject a fake fetch and a fake Resend send

Depends on: the start conditions in "Assignment 4 start conditions." Rebase and re-run tests before opening the pull request. Do not start from the opened #289 key or the opened #290 `succeeded`-only GHL rule.

`deliverLive` is omitted, matching `google_sheets.v1`. `simulate` returns a redacted payload and does not open a socket. The scanner's send function is the existing `sendTransactionalEmail`. Tests pass a fake. The scanner returns immediately when the flag is not exact `true`.

Does not own: the Sheets writer, the GHL executor, intake, or the Team Workspace UI.

### Assignment 5 — do not start from this contract

Live `deliverLive`, the webhook PUT, production flag changes, staff invites, and any edit to #227's intake hook. Those need a separate operator authorization after assignment 4 has been reviewed. They are described in the canary section so the shape is fixed, and they are not an assignment.

### Explicit non-assignments

- Do not merge, close, or rebase #207, #227, #238, #239, #241, #245, #267, #276, #284, or #287 as part of this work.
- Do not merge #289 or #290 as opened. Amend them on their own branches after this contract is on master.
- Do not edit the protected surfaces.
- Portal lane owns nothing in this contract.
- Do not implement GHL inbound workflow delivery by enabling `webhook.generic.v1`.

## Tests

Docs-only review of this pull request needs no application suite.

Later assignments run the targeted tests they add, plus the nearest existing suite when they touch a shared file:

| Assignment | Command |
| --- | --- |
| 1 | `pnpm prisma:generate`, local `prisma migrate deploy` twice, then `pnpm --filter @sa360/api test` for the new claim and secret tests |
| 2 | `pnpm --filter @sa360/api exec node --import tsx/esm --import ./src/test/set-test-env.ts --test src/services/delivery-success/canonical-delivery.test.ts src/services/fulfillment-shadow/delivery-planning.company-sheets.test.ts` |
| 3 | `pnpm --filter @sa360/admin-coc test` for the new workspace tests, `pnpm --filter @sa360/admin-coc lint`, and the new API route test |
| 4 | The new adapter and scanner tests, then `pnpm --filter @sa360/api test` if the execution registry change is shared |

Required cases:

- Sheets `succeeded` with `appendStartedAt` null and `finishedAt` set can qualify. Sheets `uncertain` with `appendStartedAt` set does not, and it creates no notification.
- A Sheets job whose idempotency key starts with `onboarding-test:` does not qualify.
- GHL `ongoing_association` plus a stored contact receipt and external id can qualify. The same run with mode `location_api` or `paused_location_test` cannot. HTTP 2xx without that receipt cannot.
- GHL `partial_success` with a skipped owner assignment and a proven contact can qualify. `partial_success` without a contact receipt cannot. A required workflow that is not enrolled cannot. A missing note step does not block a proven contact.
- One client and one source lead that qualifies on both Sheets and GHL inserts one notification row. The second receipt fills an evidence column and does not send a second email.
- A lead that finished before `enabledAt`, or while the preference was off, creates no row. Enabling the preference does not backfill it.
- The preference cannot be stored with `enabled` true and a null verified recipient.
- An enabled `webhook.generic.v1` target does not create a `DeliveryInstruction` while the custom-webhook flag is off. A `ghl.crm.v1` target still does.
- Two concurrent notification claims produce one `sending` row.
- A second scan after `sent` does not call the mailer.
- Observer and portal sessions cannot read the workspace.
- Ticket context fixtures contain the ids and do not contain `endpointUrl`, `signingSecret`, a recipient address, or a lead phone.

Do not skip, delete, or loosen a failing test. Do not point tests at a remote database or a live provider.

## Rollback

Code rollback is reverting the assignment pull request. Data rollback does not drop the new tables. Applied migrations stay.

The running system returns to current behavior when:

- `SA360_TEAM_WORKSPACE_ENABLED` and `NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED` are unset. The API answers `404` `team_workspace_disabled`. The nav item is gone.
- `SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED` is unset. Planning excludes `webhook.generic.v1`. `deliverLive` is absent.
- `SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED` is unset. The scanner returns before a query and before Resend.
- No `webhook.generic.v1` row was set to `enabled`.

Stop and roll back the assignment if any of these happen in review or in a local canary:

- A test or a local run calls Google, GHL, Meta, Resend, or a host that is not the injected fake.
- A `CompanySheetsDeliveryJob`, `GhlLiveDeliveryRun`, routing row, Meta grant, or export package changes.
- An observer can open `/team-workspace`.
- Planning emits a webhook instruction while the flag is off.
- Two emails leave for one client and source lead, or for one `idempotencyKey`.
- A notification is created for an onboarding test, an uncertain job, or a lead that finished before that client's `enabledAt`.

Unsetting a flag is the production rollback. Deleting notification rows is not required and is not allowed from an agent.

## Production canary

This section is the future operator plan. It is not authorization to run it. No assignment in this contract deploys or sets a production variable.

Order, after assignments 1 through 4 are on master and their tests are green:

1. Deploy the code with every new flag unset. Confirm Team Workspace returns `404` `team_workspace_disabled` and that a known GHL and Sheets client is unchanged.
2. On a non-production process, set `SA360_TEAM_WORKSPACE_ENABLED` and the UI flag. Read one fixture client. Confirm the response contains no endpoint URL, secret, or lead payload.
3. Set `SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED` only on that non-production process. On one fixture client, store a verified recipient the operator controls and set the preference on. Insert one local fixture that qualifies on both Sheets and GHL after `enabledAt`. Confirm one email to that recipient and a second scan that does not send. Confirm a fixture that finished before `enabledAt` sends nothing. Do not set `SA360_DELIVERY_SUCCESS_NOTIFY_TO`.
4. Custom webhook, still non-production: a loopback receiver only. `SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED=true` and one row with `enabled` true for a client that has no live GHL and no Sheets dispatch. Send one fixture. Confirm one signed request and one notification. A second call for the same client and source lead does not send again. The webhook HTTP status does not count as a GHL or Sheets receipt.
5. Unset all four flags. Leave the rows.

Do not canary against a paying client, a production spreadsheet, a production GHL location, a Meta Page, or a Zapier URL. Do not turn on `campaignDispatchEnabled`, `deliveryEnabled`, or a Meta capture grant for the canary.

Abort the canary if any request host is not the loopback receiver or Resend, or if an existing delivery row changes.

## Recommended next assignments

Start only after this contract is on `origin/master`. Branch from that master. If master has moved, rebase, re-read the protected list, and re-check the open pull requests before editing.

1. Merge this docs correction. Do not migrate and do not set a flag.
2. Auth/Account agent: amend #289 to the migration plan in this revision. No routes and no live calls. Do not merge the opened head.
3. Ingestion agent: amend #290 to the channel predicates in this revision. No schema edit and no live calls. Do not merge the opened head. This can proceed in parallel with the #289 amendment after this document is on master.
4. Quality agent: assignment 3, read-only Team Workspace, the on/off presentation above, flags default off, contextual ticket payload, observer denied. No recipient form on that page.
5. Auth/Account agent, after amended #289 is on master: the preference on/off route and the Admin C.O.C. recipient route. Still no send. Quality adds the recipient form only after that route exists, on an Admin C.O.C. screen rather than Team Workspace.
6. Ingestion agent: assignment 4 only under "Assignment 4 start conditions."

Do not start assignment 5. Do not merge or close the open pull requests listed above. Do not enable live webhook delivery or live notification sending.
