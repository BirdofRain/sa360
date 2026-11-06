# Team Workspace and configurable delivery v1

Implementation contract only. This document does not deploy, migrate, toggle a flag, merge or close a pull request, call Google, GoHighLevel, Meta, Resend, or any customer webhook, or write a production row.

GitHub status below was read from the GitHub API on Friday, November 6, 2026, after 3:24 PM ET. Re-check GitHub before acting on any open pull request. Do not trust an older copy of this section.

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

Successful-delivery notification is a new internal email, default off, for a canonical receipt. It is not the existing customer "order is ready" email and not the support-ticket email.

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
| Internal successful-delivery email | Nothing scans a canonical Sheets job or GHL run and sends one internal email. Support-ticket notify is not that email. Customer release notify is not that email. |
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
| Customer "order is ready" email | `LeadDeliveryExportPackage` notify columns | The new internal notification |
| Internal delivery email, once built | `DeliverySuccessNotification` | Resend's response alone |
| Support ticket | `SupportTicket` | A delivery receipt |

`validateDeliveryTargetMetadata` rejects keys that look like tokens, secrets, passwords, or credentials. The signing secret must not be stored in `configMetadataJson`. Onboarding audit SQL already rejects webhook URLs inside `metadataJson`. Do not put the endpoint URL in that audit or in a ticket.

## Canonical successful delivery

A receipt is canonical only for its own channel. Sheets success does not imply GHL success. An HTTP 2xx does not imply a note or a workflow. A test receipt is never canonical.

### Company Sheets campaign lead

All of the following:

- `CompanySheetsDeliveryJob.kind` is `lead`.
- `status` is `succeeded`.
- `rowsWritten` is at least 1.
- Every `CompanySheetsDeliveryRow` for that job has `status` `written`.
- `appendStartedAt` and `finishedAt` are set.
- `clientAccountId` matches the destination and the dispatch intent.
- A `CompanySheetsDispatchIntent` exists with `kind` `campaign_lead`, the same `sourceLeadEventId`, and `createdAt` greater than or equal to `CompanySheetsDestination.campaignDispatchNotBefore`.
- `sourceLeadEventId` is not `synthetic-campaign-test`.

`findProductionSheetsDelivery` is the current onboarding evidence query for the job id. It checks kind, status, client, cutoff intent, and the synthetic id. The row and timestamp checks above are part of the canonical definition even though that helper does not load them.

These are not campaign success: kind `canary`, `campaign_test`, `onboarding_captured_test`, or `aged_release`; status `queued`, `running`, `retryable`, or `uncertain`; a job whose append started and then became `uncertain`; a permission probe; a header write by itself; `spreadsheetDeliveredAt`.

Aged release stays on its own path. Its operator receipt is `spreadsheetDeliveredAt`. Its customer email stays `notifyCustomerDeliveryReleased`. This contract does not send a second email for that package.

### GoHighLevel location API

All of the following:

- `GhlLiveDeliveryRun.mode` is `ongoing_association`.
- `status` is `succeeded`. `partial_success`, `executing`, `failed`, and `skipped_duplicate` are not success. `deliveryRetryDisposition` already holds those runs.
- The contact operation from `separateDeliveryResults` is `upserted` or `replayed`, and the contact step has an external id.
- No operation outcome on that run is `ambiguous`, `rejected`, or `failed`.
- When `ClientGhlDestination.workflowStartRequired` is true, the workflow result is `enrolled` or `replayed`. When it is false, a skipped workflow can still be canonical.
- When `ClientOnboardingDestinationProfile.notesEnabled` is true, the note result is `persisted`. When notes are off, `disabled` is acceptable.
- The `GhlAssociationDispatchOutbox` row for that source lead is `settled`, `externalCallExecuted` is true, `lastError` is null, and `liveRunId` is this run.

Not success: mode `live_canary` or `paused_location_test`; an onboarding `ClientOnboardingTestAttempt`; HTTP acceptance without a contact id; a note id used as workflow proof; `workflow_enrolled` inferred from a contact upsert; an outbox row left `uncertain` or `executing`.

`findProductionGhlReceipt` is not the canonical predicate. It requires mode `location_api`, which production association runs do not use. A later assignment may teach that helper to call the shared predicate. It must not widen success to `partial_success` or to test modes.

### Outbound custom webhook

No canonical webhook receipt exists on this baseline.

When a later assignment adds one, it is canonical only when all of the following are true:

- The global flag and the per-client `enabled` flag were both on before the send.
- The attempt row records `externalCallExecuted` true, HTTP status 200 through 299, a redacted response, and `finishedAt`.
- The idempotency key is unique for that client and source lead.
- The request was signed with the stored secret.
- The outcome is not a timeout, a redirect, a 4xx, or a 5xx.

A shadow validation of `endpointUrl` is not a receipt. `readinessStatus` `ready_for_shadow` is not a receipt.

## Exactly-once notification policy

One internal email per canonical receipt. The receipt id is the Sheets job id, the GHL live-run id, or the future webhook attempt id.

- Durable row `DeliverySuccessNotification`.
- Unique `idempotencyKey`: `company_sheets:{jobId}`, `ghl_location_api:{liveRunId}`, or `custom_webhook:{attemptId}`.
- Status values: `pending`, `sending`, `sent`, `skipped`, `failed`. The same words as the customer release notifier. Do not add synonyms.
- The scanner or the new webhook writer inserts `pending` in the same transaction as its own decision that the receipt is canonical. A second insert for the same key is a no-op.
- The sender claims with a conditional update from `pending` or `failed`, or from `sending` older than 10 minutes, to `sending`. Claim count must be 1.
- Resend `Idempotency-Key` is that `idempotencyKey`, truncated to 256 characters, matching `sendTransactionalEmail`.
- `sent` is terminal. A later scan does not send again.
- `skipped` means the flag was on and the receipt was canonical, but `RESEND_API_KEY`, `SA360_TRANSACTIONAL_EMAIL_FROM`, or `SA360_DELIVERY_SUCCESS_NOTIFY_TO` was missing. It is not retried by the ordinary scan.
- Email failure sets `failed` and does not change the delivery row.
- No notification row is inserted for a test, a preview, a probe, an uncertain job, a partial GHL run, or an aged-release package.
- Turning the flag on does not backfill receipts that became canonical while the flag was off. The first enabled scan sets `DeliverySuccessNotificationCursor.armedAt` to the current time and inserts nothing. Later scans consider only receipts whose completion time is strictly after `armedAt`. `armedAt` is never moved earlier.
- Recipients are the internal list in `SA360_DELIVERY_SUCCESS_NOTIFY_TO` only. There is no default recipient. The client portal email is not a recipient.
- The scanner does not call Google, GHL, Meta, or the customer webhook. It does not change job status, run status, routing, or `spreadsheetDeliveredAt`.
- Do not call `notifyCustomerDeliveryReleased` or `notifySupportTicketCreated` for this event.

Support-ticket email stays best-effort and separate. A ticket is not a delivery notification, and a delivery notification does not open a ticket.

## Data and API contract

Closed vocabulary. Implement these strings.

### Flags

Every new flag defaults off. Only `trim()` equal to the exact string `true` enables it. `TRUE`, `1`, `yes`, and `on` stay off. That matches `SA360_CLIENT_ONBOARDING_V2_READ_ENABLED` (`trim() === "true"`). It is stricter than `SA360_GHL_ONGOING_DELIVERY_ENABLED`, which lowercases before the compare, and stricter than `NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED`, which treats `1`, `true`, `yes`, and `on` as on. Do not copy those looser parsers.

| Flag | Process | Default | Enables |
| --- | --- | --- | --- |
| `SA360_TEAM_WORKSPACE_ENABLED` | API | unset | `GET /admin/v1/team-workspace/clients/:clientAccountId` |
| `NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED` | Admin C.O.C. | unset | The nav item and the page shell. It does not authorize an API call. The public prefix is acceptable only because the API still checks the server flag and the admin session. |
| `SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED` | API | unset | Registration of a simulate-only adapter and, in a later assignment, a live POST. Off means `webhook.generic.v1` stays excluded from LF2 planning even if a row is `enabled`. |
| `SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED` | API | unset | Insert and send of `DeliverySuccessNotification`. Off means the scanner returns before a query. |

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
  "notifications": {
    "enabled": false,
    "items": []
  }
}
```

`setupRequest.operational` is always false. `destinationChoice` is the setup JSON enum `ghl`, `google_sheets`, `both`, `intake_only`, or `undecided`. `recentCanonicalDeliveries` uses the predicate in this document, at most 20 rows, newest first. Each item is `{ "channel", "receiptId", "sourceLeadEventId", "canonical", "at" }` with `channel` of `company_sheets` or `ghl_location_api`. `custom_webhook` appears only after that receipt exists. `endpointHost` is the hostname only.

`notifications.items` is empty until the notification table exists. The field is present so the page does not invent a second response later.

### Custom webhook configuration

Not in the first assignment. The later write, when authorized, is:

`PUT /admin/v1/team-workspace/clients/:clientAccountId/custom-webhook`

Body: `requestId` UUID, `expectedRevision`, `endpointUrl` (`https` only), `signingSecret` present on create, `enabled` default false. The secret is write-only. The response returns `endpointHost`, `secretFingerprint`, `enabled`, and `revision`. A conflict on revision is `409`.

Creating or updating this row does not set `DeliveryTarget.enabled`, `isPrimary`, or `isRequired` to true. It does not set `CompanySheetsDestination` dispatch flags or `ClientGhlDestination.deliveryEnabled`.

### Notification claim

No public send route. A worker function `scanCanonicalDeliveryNotifications` runs only when `SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED` is exact `true`. It inserts missing `pending` rows for receipts that became canonical after the flag was observed on, then claims and sends. Tests call it with a fake `sendTransactionalEmail`.

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

Observer denial is path-exact. A new `/team-workspace` page is denied because it is absent from the allowlist. Do not add a prefix rule.

The actor label on onboarding audit remains untrusted. It must not authorize the workspace.

Signing secrets use a new encryption key name, `SA360_CUSTOM_WEBHOOK_SECRET_KEY`. Do not reuse `META_TOKEN_ENCRYPTION_KEY` or the Google token key. Tests use a local fixture key. The ciphertext and the plaintext never go to logs, tickets, or `configMetadataJson`.

`endpointUrl` is stored for the sender and is not returned in full by the read API. Logs store the receipt id and the HTTP status.

## Migration plan

Only the Auth/Account assignment may add a migration, and only the one described here. It is additive. It does not edit an existing migration. It runs only against local `127.0.0.1` databases.

New models:

- `ClientCustomWebhookDestination`. One row per `clientAccountId`. Optional unique `deliveryTargetId` pointing at the `webhook.generic.v1` target. Columns: `endpointUrl`, `signingSecretCiphertext`, `signingSecretFingerprint`, `enabled` default false, `revision` default 1, timestamps. No relation that cascades a send.
- `DeliverySuccessNotification`. Unique `idempotencyKey`. Columns listed in the notification policy. Index `(status, claimedAt)` and `(clientAccountId, createdAt)`.
- `DeliverySuccessNotificationCursor`. One singleton row. `armedAt` is null until the first scan that sees the notify flag on. That scan sets `armedAt` and does not insert. The column is not updated to an earlier time.

No change to `CompanySheetsDeliveryJob`, `GhlLiveDeliveryRun`, `SourceLeadEvent`, `MetaPageCaptureGrant`, `ClientOnboardingSetup`, or `LeadDeliveryExportPackage`.

`DeliveryTarget.enabled` for `webhook.generic.v1` stays false in this migration. Do not backfill enabled rows.

Apply with `pnpm exec prisma migrate deploy` on the local `sa360` and `sa360_test` databases, then run it again and confirm a no-op. Do not run migrate against a remote database.

Until that migration is on master, the other lanes do not query the new models. They stop at the dependency instead of creating a second table from application code.

## Per-agent ownership and dependencies

Lanes are the ones in `docs/development/PARALLEL_AGENT_WORK.md`. Each assignment is one branch and one pull request. Rebase onto updated `origin/master` before merge. Do not batch-merge.

### Assignment 1 — Auth/Account, first

Schema and claim primitive only. No HTTP send. No route mount. No flag turned on.

Owns:

- `prisma/schema.prisma` for the three models above, and one new directory under `prisma/migrations/`
- `apps/api/src/lib/custom-webhook-secret.ts`
- `apps/api/src/lib/delivery-success-notification-env.ts`
- `apps/api/src/services/delivery-success-notification/notification-claim.ts`
- tests beside those files

Does not own and must not edit: delivery planning, the GHL executor, the Sheets writer, Meta and Facebook files, admin nav, onboarding UI, `admin-auth.ts`, `workspace-auth.ts`, `client-portal-auth.ts`.

Depends on: this contract on master. Nothing else.

Done when: local migrate applies twice, the claim test proves two concurrent claims yield one winner, secret metadata is rejected by `validateDeliveryTargetMetadata`, and both new flags are off unless a test sets them.

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

Depends on: this contract. It does not depend on assignment 1.

Done when: the predicate tests cover every non-success listed above, including `ongoing_association` versus `location_api`, and planning still excludes both Sheets adapter keys.

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

Depends on: existing onboarding and destination reads. If `SA360_CLIENT_ONBOARDING_V2_READ_ENABLED` is off, the workspace still renders the client and shows onboarding as unavailable. It does not turn that flag on. Notification items stay empty until assignment 4.

The support control on this page uses the existing `SupportTicketButton` with the context object in this contract. Build that context in `apps/admin-coc/src/lib/team-workspace/ticket-context.ts`. Do not change `capture-context.ts` except to call it.

Done when: flag off hides the nav item and the API returns `404` `team_workspace_disabled`; an observer receives `403` and is not added to the allowlist; the page renders from fixture JSON without a browser call to Google or GHL.

### Assignment 4 — Ingestion, after 1 and 2 are on master

Simulate-only webhook adapter and the notification scanner. Still no live POST to a customer host.

Owns:

- `apps/api/src/services/fulfillment-execution/custom-webhook-execution.adapter.ts`
- `apps/api/src/services/fulfillment-execution/execution-adapter.registry.ts`, register the adapter with `deliverLive` absent
- `apps/api/src/services/delivery-success-notification/scan.ts`
- tests that inject a fake fetch and a fake Resend send

Depends on: assignments 1 and 2 on `origin/master`. Rebase and re-run tests before opening the pull request.

`deliverLive` is omitted, matching `google_sheets.v1`. `simulate` returns a redacted payload and does not open a socket. The scanner's send function is the existing `sendTransactionalEmail`. Tests pass a fake. The scanner returns immediately when the flag is not exact `true`.

Does not own: the Sheets writer, the GHL executor, intake, or the Team Workspace UI.

### Assignment 5 — do not start from this contract

Live `deliverLive`, the webhook PUT, production flag changes, staff invites, and any edit to #227's intake hook. Those need a separate operator authorization after assignment 4 has been reviewed. They are described in the canary section so the shape is fixed, and they are not an assignment.

### Explicit non-assignments

- Do not merge, close, or rebase #207, #227, #238, #239, #241, #245, #267, #276, #284, or #287 as part of this work.
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

- Sheets `uncertain` with `appendStartedAt` set is not canonical and creates no notification.
- GHL `ongoing_association` plus contact `upserted` can be canonical. The same run with mode `location_api`, `paused_location_test`, or `partial_success` cannot.
- An enabled `webhook.generic.v1` target does not create a `DeliveryInstruction` while the custom-webhook flag is off. A `ghl.crm.v1` target still does.
- Two concurrent notification claims produce one `sending` row.
- A second scan after `sent` does not call the mailer.
- Observer and portal sessions cannot read the workspace.
- Ticket context fixtures contain the ids and do not contain `endpointUrl`, `signingSecret`, or a lead phone.

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
- Two emails leave for one `idempotencyKey`.
- A notification is created for an onboarding test or an uncertain job.

Unsetting a flag is the production rollback. Deleting notification rows is not required and is not allowed from an agent.

## Production canary

This section is the future operator plan. It is not authorization to run it. No assignment in this contract deploys or sets a production variable.

Order, after assignments 1 through 4 are on master and their tests are green:

1. Deploy the code with every new flag unset. Confirm Team Workspace returns `404` `team_workspace_disabled` and that a known GHL and Sheets client is unchanged.
2. On a non-production process, set `SA360_TEAM_WORKSPACE_ENABLED` and the UI flag. Read one fixture client. Confirm the response contains no endpoint URL, secret, or lead payload.
3. Set `SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED` only on that non-production process, with `SA360_DELIVERY_SUCCESS_NOTIFY_TO` pointed at an internal mailbox the operator owns. Insert one local canonical fixture. Confirm one email and a second scan that does not send.
4. Custom webhook, still non-production: a loopback receiver only. `SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED=true` and one row with `enabled` true for a client that has no live GHL and no Sheets dispatch. Send one fixture. Confirm one signed request and one notification. A second call with the same idempotency key does not send again.
5. Unset all four flags. Leave the rows.

Do not canary against a paying client, a production spreadsheet, a production GHL location, a Meta Page, or a Zapier URL. Do not turn on `campaignDispatchEnabled`, `deliveryEnabled`, or a Meta capture grant for the canary.

Abort the canary if any request host is not the loopback receiver or Resend, or if an existing delivery row changes.

## Recommended next assignments

Start only after this contract is on `origin/master`. Branch from that master. If master has moved, rebase, re-read the protected list, and re-check the open pull requests before editing.

1. Auth/Account agent: assignment 1. Additive migration, secret helper, notification claim. No routes and no live calls.
2. Ingestion agent: assignment 2, in parallel with 1. Canonical predicate and `webhook.generic.v1` planning exclusion. No schema edit and no live calls.
3. Quality agent: assignment 3, in parallel with 1 and 2. Read-only Team Workspace, flags default off, contextual ticket payload, observer denied.
4. Ingestion agent: assignment 4 only after 1 and 2 have merged. Simulate-only webhook adapter and flag-gated scanner. Rebase onto the updated master and re-run the tests.

Do not start assignment 5. Do not merge or close the open pull requests listed above.
