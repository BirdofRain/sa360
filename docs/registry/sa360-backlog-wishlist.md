# SA360 Backlog / Wishlist

This document captures future SA360 backlog and wishlist items that are not yet implementation-approved. Items here may inform Admin C.O.C. planning, launch-kanban cards, design work, or later technical prompts, but they do not authorize building database models, API routes, UI screens, GHL fields, snapshot changes, workflows, or sync/write actions by themselves.

## P1 - Client Launch Configuration / Setup Settings

Status: backlog / wishlist only; do not implement until explicitly instructed.

### Summary

Create a structured setup/settings area for each SA360 client that stores the launch-critical configuration values needed to cut over a client successfully.

This should eventually allow SA360 admins to manage client-specific setup preferences and sync selected values into the client's GHL subaccount custom values after snapshot deployment.

The initial goal is not full automation. The initial goal is to make setup values visible, structured, editable, and tied to onboarding/cutover readiness.

### Problem Statement

Client onboarding currently depends on scattered setup information that is easy to miss, inconsistently documented, and hard to verify during client cutover. Examples include:

- Calendar links and calendar IDs
- Green/blue phone numbers and forwarding numbers
- AI status/preferences, CloseBot readiness, and Voice AI state
- Appointment reminder settings
- Niche/product setup
- Campaign/source mapping
- Portal login status
- Snapshot/custom value readiness

SA360 needs a single source of truth for launch configuration before automating any sync of these values into GHL.

### Admin C.O.C. Placement Recommendation

Keep this feature internal to Admin C.O.C. and attached to the client onboarding/cutover flow. Do not put it in Client Portal initially.

Recommended placement options:

1. Admin C.O.C. -> Client Detail -> Setup Settings
2. Admin C.O.C. -> Launch Kanban -> Client Setup Drawer
3. Admin C.O.C. -> Onboarding Checklist -> Configuration section

Recommended first placement: Client Detail -> Setup Settings, with a readiness summary also available from the Launch Kanban or onboarding checklist.

### MVP Scope

Phase 1 should be manual save/edit only:

- Store setup values in SA360 as the source of truth.
- Provide an internal admin UI to edit setup values.
- Show missing/required fields by setup section.
- Tie setup values to onboarding/cutover checklist readiness.
- Show section-level complete/missing status.
- Track last updated timestamp and updated-by identity when available.
- Do not sync, push, mutate, or overwrite GHL custom values in the MVP.

The Admin C.O.C. setup page/card should include these sections:

1. Identity
2. Calendar
3. Phone Numbers
4. AI / Automation
5. Routing
6. Portal
7. Cutover Readiness

Each section should show:

- Complete/missing status
- Required fields
- Optional fields
- Last updated timestamp
- Who updated it, if available

The readiness summary should be able to call out missing or incomplete launch gates such as:

- Missing required calendar link
- Missing green number
- CloseBot not marked ready
- Test lead not passed
- Portal login not verified

### Suggested Data Fields

#### Client Identity

- `client_account_id`
- `client_display_name`
- `agent_name`
- `agency_name`
- `timezone`
- `niche_product_type`
- `launch_status`

#### Calendar Settings

- `calendar_booking_url`
- `calendar_id`
- `appointment_calendar_name`
- `reschedule_url`
- `timezone`

#### Phone / Messaging Settings

- `primary_sms_number`
- `secondary_sms_number`
- `green_number`
- `blue_number`
- `forwarding_number`
- `call_tracking_number`
- `texting_enabled`

#### AI / Automation Settings

- `voice_ai_enabled`
- `closebot_ready`
- `closebot_enabled`
- `closebot_inbox_id`
- `ai_followup_enabled`
- `appointment_reminders_enabled`
- `missed_call_text_back_enabled`
- `nurture_enabled`

#### Routing / Source Settings

- `source_subaccount_id`
- `destination_ghl_location_id`
- `campaign_id`
- `campaign_name`
- `niche_key`
- `product_type`
- `source_platform`
- `source_form_id`

#### Portal / Access Settings

- `portal_login_email`
- `portal_access_enabled`
- `portal_verified_at`
- `client_visible_metrics`

#### Cutover Readiness

- `snapshot_applied`
- `custom_values_verified`
- `routing_rule_verified`
- `test_lead_passed`
- `first_text_verified`
- `portal_login_verified`
- `admin_cutover_approved`
- `live_at`

### Future GHL Custom Value Sync Plan

Start with stored SA360 config as the source of truth. Do not immediately mutate GHL snapshots or custom values.

Recommended phased approach:

#### Phase 1

- Store setup values in SA360.
- Add Admin C.O.C. UI for manual save/edit.
- Show missing/required fields.
- Tie values to onboarding/cutover checklist readiness.

#### Phase 2

- Generate a custom value mapping payload.
- Add copy-to-clipboard support for manual paste into GHL.
- Add validation against GHL custom values if API support already exists.
- Add audit logging for setup and sync-related changes.

#### Phase 3

- Push selected custom values to GHL only with explicit admin confirmation.
- Show sync status and last synced timestamp.
- Prevent overwrites without a diff preview.

#### Phase 4

- Automate portions of setup after snapshot deployment.
- Support AI, CloseBot, and Voice AI preference templates.
- Add reusable setup templates by niche/product type.

### Safety Constraints

- Do not expose one client's settings to another client.
- Do not auto-overwrite GHL custom values.
- Do not turn AI or automation features on automatically without confirmation.
- Do not change routing behavior as part of this feature unless explicitly requested.
- Keep this feature tied to onboarding/cutover readiness.
- Include audit logging for any future sync/write action.
- Treat future GHL writes as explicit admin actions with confirmation, diff preview, sync status, and durable audit trail.
