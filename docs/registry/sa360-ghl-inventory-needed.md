# GHL Inventory Needed

Cursor cannot verify the live GHL source account from this repo alone. Export or copy the sections below before creating any new fields, tags, workflows, custom values, pipelines, calendars, forms, or snapshot assets.

## Custom Fields

Paste every contact/opportunity custom field, including hidden/system fields.

| Field ID | Display Name | Field Key / Unique Key | Object | Type | Options / Values | Folder | Required? | Used In Workflows | Notes |
|---|---|---|---|---|---|---|---|---|---|
| | | | contact/opportunity | | | | | | |

## Tags

Paste all tags, including legacy tags and workflow-only trigger tags.

| Tag Name | Normalized Name | Folder / Category | Current Usage | Workflow Trigger? | Should Be Field Instead? | Notes |
|---|---|---|---|---|---|---|
| | | | | yes/no | yes/no | |

## Workflows

Paste workflow names, folders, status, triggers, and actions.

| Workflow Name | Folder | Status | Trigger(s) | Reads Fields | Writes Fields | Adds/Removes Tags | Sends Messages | Webhook/API Calls | Purpose | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| | | active/draft/off | | | | | | | | |

## Workflow Folders

| Folder Name | Included Workflows | Module Guess (M1/M2/Voice/Meta/Admin) | Owner | Notes |
|---|---|---|---|---|
| | | | | |

## Custom Values

Paste all custom values, especially message templates and config/copy values.

| Custom Value Key | Display Name | Value Preview | Category | Used In Workflows | Secret? | Should Move To DB/Env? | Notes |
|---|---|---|---|---|---|---|---|
| | | | message/config/copy | | yes/no | yes/no | |

## Pipelines And Stages

| Pipeline ID | Pipeline Name | Stage ID | Stage Name | Status Meaning | Maps To Field | Maps To Event | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | policy_status/lifecycle_stage/appointment_status | | |

## Calendars

| Calendar ID | Calendar Name | Owner / Agent | Calendar Link | Client Account | Subaccount / Location ID | Used In Workflow | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Forms And Surveys

| Form/Survey ID | Name | URL | Fields Submitted | Tags Added | Workflow Triggered | Source/Niche | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Webhook Payload Bodies

Paste one real redacted example for each GHL webhook/workflow webhook that calls SA360 or other systems.

| Source Workflow | Trigger Event | Destination URL | Headers Used | Payload Body (Redacted) | Expected Response | Notes |
|---|---|---|---|---|---|---|
| | | | x-sa360-secret? | | | |

## Custom Menu Links

| Link Name | URL | Location / Account Scope | Opens Admin C.O.C.? | Required For Beta? | Notes |
|---|---|---|---|---|---|
| | | | yes/no | yes/no | |

## Dashboard Widgets

If GHL dashboards currently expose SA360 concepts, paste or screenshot their widget definitions.

| Dashboard Name | Widget Name | Metric / Data Source | Filters | Maps To SA360 Object | Notes |
|---|---|---|---|---|---|
| | | | | | |

## Snapshot Assets

| Snapshot Asset Type | Name | ID / Key | Contains Fields? | Contains Workflows? | Contains Tags? | Contains Custom Values? | Notes |
|---|---|---|---|---|---|---|---|
| | | | yes/no | yes/no | yes/no | yes/no | |

## Minimum Export Set For Registry Review

- All custom fields with keys and options.
- All tags.
- All workflows with triggers/actions.
- All custom values.
- All pipelines/stages.
- All calendars and links.
- Redacted webhook payload examples for lifecycle, appointment, sale/opportunity, and voice-related flows.
- Any snapshot import/export manifest if this account came from a snapshot.
