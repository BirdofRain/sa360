# Nonoperational source association

This note records the Phase 2D audit. It does not migrate the database, add a route, or change a feature flag.

## What already exists

| Fact | Source of truth | Write behavior |
| --- | --- | --- |
| LeadCapture / NextGen source registry | `SourceFunnel` | `observeNextGenSourceFunnel` records a seen source during intake. It may set `suggested`. It does not confirm origin. |
| Verified client-source association | `SourceFunnel.associationStatus = confirmed` and `originClientAccountId` | `confirmSourceFunnelOrigin` and `associateSourceFunnelByPageUrl` (`POST /admin/v1/clients/:clientAccountId/source-funnels`). |
| Cross-client move | same row | `reassignSourceFunnelOrigin` rewrites inventory origin for the previous client. `clearSourceFunnelAssociation` clears it. |
| Campaign destination | `CampaignRoutingRule` | `createRoutingRuleAdmin` inserts a rule. `active` defaults to true. `deliveryEnabled` is forced false on create. `shadowDeliveryEnabled` is forced true. |
| Saved onboarding request | `ClientOnboardingSetup.data` | `intent: save_draft` only. It stores the requested funnel id and campaign id. It does not associate a source or create a rule. |
| Facebook form association and source-resolution review | Meta capture models and `facebook-form-association` | Protected intake behavior. Not an onboarding write. |

`suggested` is not routing authority. `resolveConfirmedLeadCaptureSourceAssociation` returns `source_not_confirmed` unless the row is confirmed with an origin. Suggestions do not stamp inventory. There is no operator route that writes only `suggested`. The suggestion write is part of live NextGen observation.

## Why confirmation is operational

`confirmSourceFunnelOrigin` does two things beyond the registry flag:

1. It stamps a null `originClientAccountId` onto inventory whose source identity matches the funnel.
2. Later inventory intake copies that confirmed origin onto new rows.

`routing-dry-run.service` then treats a confirmed LeadCapture association as a destination when no exact campaign-rule tier matched. That destination is `routingAuthority = confirmed_source_association`. Association GHL dispatch and the company Sheets pilot both consult that authority. Delivery still has its own arming flags, but the routing decision has already changed.

A confirmed association is therefore not a nonoperational setup request.

## Why `active: false` is not a safe campaign mapping

`matchCampaignRoutingRule` ignores a rule when `active` is false, or when the effective window has not started or has ended. An active rule still matches when `deliveryEnabled` is false. The matcher tests cover both facts.

`createRoutingRuleAdmin` does not default `active` to false. Omitting it stores `active: true`, so the new row is live routing even though delivery is off. An explicit inactive insert would still be a `CampaignRoutingRule` row. A later patch can turn it on. This phase does not create or modify those rows.

## What this phase adds

`reviewSavedSourceCampaignRequest` compares a saved request with source and rule rows the caller already loaded. It returns whether the source is incomplete, missing, only suggested, confirmed for this client, confirmed for someone else, or ambiguous. It returns whether the campaign id is missing, unused, present only on an inactive rule, or already a live rule. It separates `sourceAssociated` from `deliveryActivated`. `deliveryActivated` is true only when a live matching rule owned by the requesting client has `deliveryEnabled`. Another client's rule does not set it, and the switch is not a receipt that GoHighLevel or Company Sheets delivered a lead.

`canApply`, `associationWrite`, and `routingRuleWrite` are false. A stale revision, a rejected request, or a repeated request id is not applied. The function does not import Prisma or the confirm/create services.

Team Workspace can show this review later. That display is a separate Admin C.O.C. change. It needs a read of funnels and rules the workspace already has. It must not call the existing confirm, reassign, clear, or routing-rule create routes.

## Schema proposal, not migrated

A later Auth/Account migration could add a request row that is not `SourceFunnel` and not `CampaignRoutingRule`:

- `clientAccountId`
- `requestId` unique per client
- `expectedRevision`
- `providerFunnelId` and `parentUrlKey`, both optional, at least one required
- `providerCampaignId` optional
- `status` of `requested`, `rejected`, or `superseded`
- no `associationStatus`, no `active`, no `deliveryEnabled`

Applying that row would remain a separate, explicit confirm or rule write. This phase does not add the table. The saved setup draft remains the only request store.

## Phase 2F request row

`SourceCampaignAssociationRequest` stores a proposal. It is not a `SourceFunnel` and not a `CampaignRoutingRule`. Recording, rejecting, or superseding a row does not confirm origin, stamp inventory, create a routing rule, or arm delivery.

The admin routes are `GET` and `POST /admin/v1/clients/:clientAccountId/source-campaign-requests`. They require the admin API key. `SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED` must be the exact string `true`. The saved `ClientOnboardingSetup` document must parse, and its revision must match the call. A stale or unreadable setup is not stored.

Merging the migration makes `sa360-migrate` apply it on the next API predeploy. That apply creates an empty table and a foreign key on `ClientAccount`. It does not turn the flag on. Do not merge until that migration is reviewed.

## Phase 2G request panel

Team Workspace shows the current request head inside the guided Source & Campaign step. It uses the existing `GET` and `POST /admin/v1/clients/:clientAccountId/source-campaign-requests` routes. The panel reads the saved setup, echoes that setup's normalized identifiers, and can reject an open proposal. It does not call source confirmation, source reassignment, `CampaignRoutingRule` creation, GoHighLevel delivery, Company Sheets dispatch, or notification sending.

The panel stays off unless `NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED`, `SA360_TEAM_WORKSPACE_ENABLED`, `SA360_NATIVE_CLIENT_SETUP_ENABLED`, and `SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED` allow it. A stored `requested` or `rejected` row is not an approved association. The source check above the panel remains the evidence for whether source records already confirm ownership.
