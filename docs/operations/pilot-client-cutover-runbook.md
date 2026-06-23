# Pilot client cutover runbook (manual)

Operator runbook for moving one pilot client from onboarding to live delivery.

**Safety posture:** Every step that changes delivery behavior is a manual operator
action. SA360 does not auto-enable live delivery on ingest. Live GHL writes stay
blocked until the env allowlist and per-rule cutover flags are set by an operator.
Do not skip the shadow validation steps. Keep `GHL_DELIVERY_ADAPTER_MODE` off in
production until the explicit cutover window.

This runbook satisfies the Launch Kanban card `lk-next-cutover-runbook`.

## Prerequisites

| Item | Where |
|------|-------|
| Pilot `clientAccountId` | Admin COC → Clients |
| Master lead source id (e.g. `lal_master_vet` or `leadcapture_io`) | Routing rule `masterClientAccountId` |
| GHL destination location id (subaccount) | `ClientGhlDestination.destinationSubaccountIdGhl` |
| Admin COC access | Internal operator login |
| Deploy access for env vars | Hosting platform (manual) |

## Phase 0 — Read the readiness report first

Open the client and review the cutover readiness panel before doing anything.

1. Admin COC → Clients → pilot client → it shows a compact readiness summary.
2. Open the client delivery-config page (`/clients/{clientAccountId}/delivery-config`)
   to see the full read-only readiness panel with per-section blockers and warnings.
3. Use the panel as your live checklist. It aggregates: client account, GHL
   destination, routing rules, portal access, delivery readiness, and environment
   allowlist status. It performs no actions.

The phases below mirror the panel sections.

## Phase A — Configuration (Admin COC + GHL)

- [ ] Confirm the `ClientAccount` exists with the correct `clientAccountId` slug.
- [ ] Connect GHL OAuth and link the location to the client (`/ghl-connections`).
- [ ] Set `destinationSubaccountIdGhl` on the client GHL destination.
- [ ] Run the OAuth probe on the delivery-config page.
- [ ] Run GHL config discovery and save: workflow id, pipeline id, stage ids,
      default owner, and the SA360 custom field map.
- [ ] Confirm the destination readiness section is green on the delivery-config page.
- [ ] Create active `CampaignRoutingRule` rows for the correct `masterClientAccountId`
      with matching attribution keys (campaign/adset/ad/form/utm).
- [ ] Confirm the readiness panel shows routing rules present with a destination.

> Scope note: the LeadCapture.io normalizer sets `source_type: leadcapture_form`.
> Rules scoped to `facebook_lead_form` will not match LeadCapture leads. Match the
> rule scope to the pilot funnel.

## Phase B — Validation (read-only / shadow)

- [ ] Set `NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID` in the Admin COC
      deploy (operator/env task; not automated).
- [ ] Routing Dry Run (`/routing-dry-run`): run a test payload and confirm it matches
      the pilot destination.
- [ ] Send a test `lead_created` webhook (operator) and confirm it in Webhook Monitor
      (`/webhooks`) and Lead Timeline (`/lead-timeline`).
- [ ] Generate a shadow delivery plan only. Review the steps. Do not run live.

## Phase C — Cutover gates (manual, sensitive)

Each of these is a deliberate operator action. None is automated by SA360.

- [ ] On `/delivery-readiness`, set `internalApprovalStatus = approved` for the rule.
- [ ] Set `clientCutoverApproved = true`.
- [ ] Set `deliveryMode = live` and `deliveryEnabled = true` only after the shadow plan
      was reviewed and the destination readiness is green.
- [ ] At deploy time, set both `SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS` and
      `SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS` to include the pilot
      client/location. Both must be set for live delivery to be enabled.
- [ ] Confirm the runtime mode on `/direct-delivery-demo` is appropriate for the
      environment.

## Phase D — Live canary (single test lead)

- [ ] Execute one live canary via `/direct-delivery-demo` with the operator
      confirmation phrase.
- [ ] Verify the contact/opportunity appears in the pilot GHL subaccount (check in
      the GHL UI).
- [ ] Confirm there is no duplicate-risk block on a production-like lead.

## Phase E — Portal and go-live

- [ ] On the client profile, set `portalEnabled = true` and set `portalLoginEmail`.
- [ ] Test `/portal/login` as the pilot user; confirm the dashboard is scoped to the
      pilot tenant only.
- [ ] Set `ClientAccount.status = active`.
- [ ] Confirm Zapier / legacy routing is disabled for the pilot funnel (manual ops).
- [ ] Move the related Launch Kanban cards to DONE.

## Rollback / abort criteria

Abort the cutover and return to shadow if any of these occur:

- A live canary creates an incorrect or duplicate contact in GHL.
- Routing matches the wrong destination in dry-run or live.
- Portal login exposes data from another tenant.
- Duplicate-risk or readiness blockers reappear after enabling live.

To roll back: set `deliveryEnabled = false` (and/or `deliveryMode = shadow`) on the
rule, and remove the pilot from the `SA360_DIRECT_DELIVERY_ALLOWED_*` env lists at
the next deploy. Leave portal disabled until the issue is resolved.

## Notes

- The cutover readiness panel is read-only. It will not change any flag, env var, or
  client field. Treat it as a checklist mirror, not a control surface.
- Live delivery is gated twice: by per-rule cutover flags and by the env allowlist.
  Both layers are intentional and must be set by an operator.
