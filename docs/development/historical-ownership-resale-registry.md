# Historical ownership and resale registry

Schema-only registry for July campaign labels and verified inventory resale rights. Migration `20261019220000_historical_ownership_resale_registry_v1`.

This migration creates empty tables and read-only decision functions. It does not stamp `LeadInventoryItem.originClientAccountId`, backfill inventory, register HTTP routes, or change the provenance eligibility gate. PR #188 stays on HOLD.

The census contract remains `historical-campaign-association-v1` in `apps/api/src/services/ppl-fulfillment/historical-campaign-association-contract.ts`. Confirmation routes stay unregistered.

## Tables

| Table | Role |
| --- | --- |
| `HistoricalCampaignAlias` | One July label inside one `inventory_lot` or `import_request` scope |
| `HistoricalCampaignAliasEvent` | Append-only suggest, confirm, reassign, conflict, and retire history |
| `HistoricalResaleAuthorization` | Resale proposal, confirmation, or revocation for one scope |
| `HistoricalResaleAuthorizationEvent` | Append-only proposal, confirmation, and revocation history |

Ownership and resale authorization are different decisions. Neither table references the other. Confirming a label does not create a resale row. Confirming resale does not set `originClientAccountId` on an alias or on inventory.

There is no second origin column on `LeadInventoryItem`. The only inventory origin column remains `originClientAccountId`. Scope keys are strings. They are not foreign keys to `InventoryLot`, `LeadInventoryItem`, or import batches, so this migration does not lock or rewrite those tables.

## Scope and label identity

`scopeType` is `inventory_lot` or `import_request`.

| Scope | `scopeKey` |
| --- | --- |
| `inventory_lot` | `InventoryLot.lotKey` |
| `import_request` | Census import key: `rawPayloadJson.importRequestId`, then `bulkImportId` |

`(none)` and `(blank)` are census sentinels for a missing key. They cannot be stored. Decision functions treat NULL, blank, `(none)`, and `(blank)` as a missing scope.

`normalizedLabel` is July `sourceCampaignName` after trim and internal-whitespace collapse. Case stays significant. `displayLabel` is one preserved July value; its normalized form must equal `normalizedLabel`. A later workbook `campaign_name` or `master.lead_type` is not a label on this table. Scope, both labels, and `createdAt` are immutable.

Unique key: `(scopeType, scopeKey, normalizedLabel)`. One client can own many labels in a scope. The same display text in another scope is a different row.

## Alias status

| Status | `originClientAccountId` | Ownership |
| --- | --- | --- |
| `unassigned` | null | No |
| `suggested` | null | No. The suggested client lives on the suggestion event |
| `confirmed` | required | Yes, for that scope and label |
| `conflicted` | null | No. Blocks the other scope |
| `retired` | null, or the last confirmed client | No. Does not block the other scope |

A suggestion event stores `nextOriginClientAccountId`. The alias row stays null until confirmation. Confirming a suggestion must use that same client. A different client is a conflict event, then a new suggestion if one is still warranted.

Reassignment updates the alias origin and appends an event whose `previousOriginClientAccountId` is the prior confirmed client and whose `nextOriginClientAccountId` is the new client. Earlier events stay. Update and delete of event rows fail. `recorded` is valid only as the first event.

Retired aliases cannot be reactivated. Confirmed aliases cannot move back to `suggested` or `unassigned`.

Every alias row has at least one event in the same transaction. The history check is deferred until commit.

## Resale evidence

`operatorNote` is operator text. It does not establish resale rights.

Confirmation requires all of the following on the authorization row and on the confirmation event:

- `evidenceType`: `purchase_agreement`, `license`, or `acquisition_record`
- `evidenceReference` with a matching prefix: `agreement:`, `license:`, or `acquisition:`
- `verificationDetails`: a short verification record, 12 to 2,000 characters
- `authorizedOperator`
- `verifiedAt` and `effectiveAt`
- optional `expiresAt` later than `effectiveAt`

The reference is an identifier for an independently held purchase agreement, license, or acquisition record. The table does not store the document. `verificationDetails` and `operatorNote` reject `data:application` payloads and `%PDF` headers. The confirmation service in the later PR must check that the external record was actually verified before it writes these fields. This database cannot see that external file.

A proposal may carry a note and may carry a draft reference. `verifiedAt`, `authorizedOperator`, `effectiveAt`, and `expiresAt` stay null while status is `proposed`. A proposal is not eligible.

At most one `proposed` or `confirmed` row exists per scope (`HistoricalResaleAuthorization_one_live_scope_key`). Revoked rows accumulate. An expired confirmation stays `confirmed` and keeps that slot until an operator revokes it. Eligibility still excludes it.

Revocation sets `revokedAt` and `revocationReason` and leaves confirmation evidence in place. A revoked row cannot be edited. A replacement authorization is a new row after revocation.

History is exactly one proposal event, then an optional confirmation, then an optional revocation. Request ids are unique per event table.

## Overlap

Call these functions. Do not reimplement the matrix in application code.

```text
historical_campaign_ownership_decision(lot_key, import_request_key, july_label)
historical_resale_authorization_decision(lot_key, import_request_key, evaluated_at)
```

Both are `STABLE`, `SECURITY INVOKER`, and read registry tables only. They do not join `LeadInventoryItem` or `InventoryLot`. They do not read exclusivity, acquisition cost, Used By, or campaign-name columns. The resale decision does not read `operatorNote`. An origin client id or authorization id is returned only when `decision` is `eligible`.

Pass the July column text. The ownership function normalizes it. Pass NULL for a missing lot or import key. `evaluated_at` is required; the resale function does not call `now()`.

### Ownership reasons

| Condition | `decision` | `reason` |
| --- | --- | --- |
| Label normalizes to empty | `not_eligible` | `fail_closed_missing_label` |
| Both scopes missing | `not_eligible` | `fail_closed_missing_scope` |
| Either scope is `conflicted` | `not_eligible` | `fail_closed_conflicted` |
| Both scopes `confirmed` for the same client | `eligible` | `eligible_scopes_agree` |
| Both scopes `confirmed` for different clients | `not_eligible` | `fail_closed_conflicting_clients` |
| One scope `confirmed`, the other absent, retired, or missing | `eligible` | `eligible_lot_only` or `eligible_import_request_only` |
| One scope `confirmed`, the other `suggested` or `unassigned` | `not_eligible` | `fail_closed_ambiguous` |
| Both scopes `suggested` or `unassigned` | `not_eligible` | `fail_closed_ambiguous` |
| One scope `suggested` or `unassigned`, the other open | `not_eligible` | `suggestion_is_not_ownership` |
| No active alias | `not_eligible` | `no_coverage` |

Retired is open coverage. It keeps history and does not veto the other scope.

### Resale reasons

A scope posture is `missing_scope`, `absent`, `revoked_only`, `proposed`, `incomplete`, `not_yet_effective`, `expired`, or `granted`.

`granted` means status `confirmed`, evidence fields complete, `effectiveAt <= evaluated_at`, and `expiresAt` is null or later than `evaluated_at`. The instant of `expiresAt` is already expired. The instant of `effectiveAt` is in force.

| Condition | `decision` | `reason` |
| --- | --- | --- |
| `evaluated_at` is null | `not_eligible` | `fail_closed_missing_evaluated_at` |
| Both scopes missing | `not_eligible` | `fail_closed_missing_scope` |
| Either live row has incomplete confirmation evidence | `not_eligible` | `fail_closed_incomplete_evidence` |
| Both scopes granted | `eligible` | `eligible_scopes_agree` |
| One scope granted, the other absent, missing, revoked-only, or expired | `eligible` | `eligible_lot_grant` or `eligible_import_request_grant` |
| One scope granted, the other proposed or not yet effective | `not_eligible` | `fail_closed_ambiguous` |
| Only a proposal is live | `not_eligible` | `proposed_not_granted` |
| Only a future `effectiveAt` | `not_eligible` | `not_yet_effective` |
| Proposal overlaps expired or not-yet-effective coverage | `not_eligible` | `fail_closed_ambiguous` |
| Latest live row is expired | `not_eligible` | `expired` |
| Only revoked history | `not_eligible` | `revoked_not_eligible` |
| No row | `not_eligible` | `no_grant` |

An expired or revoked authorization is not eligible. A revoked lot does not cancel an in-force import grant. A live proposal on the other scope does cancel use of an in-force grant until that proposal is confirmed or revoked.

Exclusivity, acquisition cost, Used By, and a campaign name cannot satisfy this function. They are not arguments and they are not columns on the resale table.

## How the ownership-confirmation PR uses this

That PR registers the association routes behind `SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED` exact `true`, default off, admin key only. It still leaves resale confirmation on its own route.

For each proposal:

1. Resolve `lotKey` from `InventoryLot.lotKey`. Resolve the import key with the census order, and pass NULL when the census would report `(none)` or `(blank)`.
2. Read July `sourceCampaignName`. Do not substitute a workbook label.
3. Call `historical_campaign_ownership_decision`.
4. Treat only `decision = 'eligible'` as coverage. Ignore a non-null alias id when the decision is anything else.
5. On `suggestion_is_not_ownership`, `fail_closed_ambiguous`, `fail_closed_conflicted`, or `fail_closed_conflicting_clients`, leave inventory origin null. Record the alias transition with a new event.
6. On `eligible`, update `LeadInventoryItem.originClientAccountId` only where it is still null, the row's lot key or import key is the eligible scope, and the July column still normalizes to the same label. Leave a different existing origin in place and record a conflict instead of overwriting it.
7. Do not write `HistoricalResaleAuthorization`. Do not copy `verifiedAcquisitionEvidenceId`, exclusivity, acquisition cost, or Used By into either table.

Preview routes stay read-only and return `stampApplied: false`.

## How the resale-confirmation PR uses this

1. Insert a `proposed` authorization and a proposal event in one transaction.
2. After the external agreement, license, or acquisition record has been verified, update that same row to `confirmed` and append a confirmation event with the prefixed reference, evidence type, verification details, operator, and dates.
3. Call `historical_resale_authorization_decision` with an explicit evaluation timestamp.
4. Treat only `decision = 'eligible'` as authorization. `expired`, `revoked_not_eligible`, `proposed_not_granted`, and `fail_closed_ambiguous` stay unauthorized.
5. Do not update `originClientAccountId`. Do not read exclusivity, acquisition cost, Used By, or campaign name. Store operator prose in `operatorNote` only.
6. To replace an expired confirmation, revoke it first so the live-scope slot is free, then insert a new proposal.
7. Return authorization ids to operator APIs. Do not add these columns to portal payloads.

## Security

Evidence documents are not stored. `evidenceReference` is an id. `verificationDetails` is a short operator-only note of how that external record was checked. Client portal routes and portal tenant context do not query these tables. `findClientAccountById` includes `ghlDestination` only, so the new `ClientAccount` relations are not loaded.

The decision functions return an origin id or authorization id only for an `eligible` result. They do not return evidence text. They are invoker-rights functions; a database role without `SELECT` on the registry tables cannot read rows through them.

Application code must keep using explicit portal selects. A later portal change that includes `historicalCampaignAliases` or selects `evidenceReference`, `verificationDetails`, or `operatorNote` would expose operator material. The guard test covers the current portal route, tenant presenter, client-account repository, and portal UI trees.

Client rekey does not rewrite these foreign keys. `ON DELETE RESTRICT` and `ON UPDATE RESTRICT` fail the rekey delete when a registry row names that client. Empty tables do not change current rekey. A later explicit procedure has to move or retain those references before such a client can be deleted.

Event and parent deletes are rejected by triggers. `session_replication_role = replica` bypasses triggers and must not be used by the API.

## Rollback

Before any registry row exists, roll back by reverting this migration and deploying that revert through the normal local-then-production migration path. The SQL drops nothing else. There is no inventory row to restore.

After any alias, event, authorization, or authorization event exists, do not drop the tables and do not edit this migration. Stop calling the decision functions and leave the rows. Eligibility then has no grant and no confirmed alias, which fails closed. Reassignment history has to remain queryable.

This change does not run against production. Deploy is a later, separate authorization. Applying the migration creates no registry rows.

## Resolved decisions

- Label normalization follows the association contract: trim and internal whitespace only. Case is a different label.
- Scope keys are not foreign keys, so import requests that exist only inside JSON can be named without an inventory migration.
- Agreement across lot and import scopes is eligible. Disagreement and an unresolved claim beside a confirmation fail closed.
- Retired alias coverage is inactive. Revoked resale history does not veto a different scope.
- Expired confirmations remain stored, ineligible, and occupying the one live slot until revoked.
- Alias evidence is optional and uses `july-label:`, `case-file:`, and `correspondence:` prefixes. Resale evidence is required for confirmation and uses different prefixes.
- Request ids are unique inside each event table.

## Follow-ups

- Ownership-confirmation and resale-confirmation PRs, as above. They are separate writes.
- An explicit client-rekey procedure for clients named by registry foreign keys.
- PR #188 remains on HOLD. This schema does not merge it and does not change selection, export, release, or replacement.
- The confirmation service must verify the external agreement, license, or acquisition record before insert. The database stores the reference, not the file.
