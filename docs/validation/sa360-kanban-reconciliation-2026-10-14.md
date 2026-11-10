# SA360 Kanban reconciliation — 14 October 2026

**Board key:** `sa360_beta_mvp_launch`
**Board name:** SA360 Beta MVP Launch
**API:** `GET/POST/PUT https://sa360-sw6oq.ondigitalocean.app/admin/v1/kanban/...`
**Auth:** existing `x-sa360-admin-key` on the active API deployment. The key was not printed or committed.
**Seed sync:** not called. `POST .../sync-seed` can overwrite descriptions, acceptance criteria, dependencies, and notes. The repository seed is not the live board.
**Production SQL:** not used.

Companion status: [launch readiness](../roadmaps/sa360-launch-readiness-2026-10-13.md).

## Before

Read at 14 October 2026, before writes.

| | |
| --- | --- |
| Cards | **78** |
| DONE | 19 |
| DOING | 14 |
| TO DO | 12 |
| VERIFY | 9 |
| BCKLG | 24 |
| P0 / P1 / P2 | 29 / 25 / 24 |
| `blocked=true` | 0 |
| Duplicate titles | 0 |

`board.updatedAt` was still `2026-05-11T20:43:35.204Z`. Card rows had later edits, including 6 October 2026 fulfillment cards. The board timestamp is not a reliable last-activity clock.

The board had no cards for Meta review, the data-deletion page, Vanessa, PRs #177–#179, the inventory map, issue #51, issue #71, or issue #155. It did have the right cards for reservation safety, order-lifecycle counters, buyer CSV State, the GHL canary, and a vague "Aged Lead Orders" placeholder.

## After

Read back immediately after the authorized metadata writes.

| | |
| --- | --- |
| Cards | **98** |
| DONE | 20 |
| DOING | 13 |
| TO DO | 19 |
| VERIFY | 22 |
| BCKLG | 24 |
| Duplicate titles | 0 |
| Cards missing from the before snapshot | 0 |
| `blocked=true` | 10 |

## What changed

| Action | Count |
| --- | --- |
| Created | 20 |
| Updated | 6 |
| Moved between columns | 1 |
| Priority changes | 2 |
| Newly completed | 1 (new Done card; no existing card was moved to Done) |
| Newly deferred to BCKLG | 0 |
| Deleted | 0 |

### Updated

| Id | Change |
| --- | --- |
| `cmp1o5sbl000f7qkoqov6yddh` | Title set to "Audit and finish DigitalOcean environment configuration". Priority P1 → P0. Stays VERIFY. Blocked. Owner Sam. Previous title kept in the description. |
| `cmuw0g2he014ohn0ua6go4stx` | "Make PPL reservation transaction safe for bulk orders". DOING P0 → VERIFY P1. #161 is deployed and LO-1055's 85-lead commit succeeded. The 300-lead acceptance criterion is still open. |
| `cmuw0gfy2014phn0uv9710hoc` | "Manual CSV release must reconcile order lifecycle". Stays TO DO P1. LO-1055 evidence appended. |
| `cmuw0gsbp014shn0uavvyuvt0` | "Normalize State in buyer CSV presentation". Stays TO DO P1. LO-1055 evidence appended. |
| `cmq18ggkc008blx0urd7a3bwa` | "Aged Lead Orders". Stays BCKLG P2, owner Alex. Noted as a historical placeholder so the specific fulfillment cards are not duplicated. |
| `cmqla37m900077qs05iezyr56` | "Controlled live delivery canary". Stays TO DO P0. Note added that LO-1055 was not an external GHL write and that issue #54 is still open. |

Existing notes on the three fulfillment cards were copied forward and then extended. Due dates were not changed. Sort order of existing cards was not rewritten. New P0 cards use negative `sortOrder` so they sit at the top of manual sorting without renumbering older cards.

### Created

| Id | Status | Priority | Title |
| --- | --- | --- | --- |
| `cmv8fcttz0085lc0uie8s9dnp` | DONE | P0 | Facebook data deletion instructions page is published |
| `cmv8fcu0y0086lc0uhafh4xqj` | VERIFY | P0 | Verify the data-deletion URL is registered in the Meta app |
| `cmv8fcu3k0087lc0uwe1jox7u` | TO DO | P0 | Record authentic Meta App Review permission videos |
| `cmv8fcu5g0088lc0u071sxdjm` | VERIFY | P0 | Capture authentic `leads_retrieval` evidence |
| `cmv8fcu7j0089lc0unkhc8m9d` | VERIFY | P0 | Remove production `FACEBOOK_DIRECT_INTAKE_ENABLED=true` |
| `cmv8fcuan008alc0uwyqsvnez` | VERIFY | P0 | Separately approve a capture-only Meta lead canary |
| `cmv8fcudi008blc0u7ez015sr` | VERIFY | P0 | Confirm production migrations for operator review and external receipts |
| `cmv8fcufo008clc0u0isvz7bo` | VERIFY | P0 | Validate deployed buyer-ready quality, operator review, and receipt suppression |
| `cmv8fcuhw008dlc0uyimohsgc` | VERIFY | P0 | Reconcile Vanessa historical delivery evidence |
| `cmv8fcule008elc0ux8u5tg7j` | VERIFY | P0 | Obtain explicit approval before the Vanessa receipt import |
| `cmv8fcupj008flc0uoes9z1em` | VERIFY | P0 | Execute the approved Vanessa receipt import |
| `cmv8fcurg008glc0u106fy5dr` | VERIFY | P0 | Validate the deployed customer inventory map |
| `cmv8fcutg008hlc0uhujo1y2m` | TO DO | P1 | Connect Front Office Inventory Explorer to live inventory |
| `cmv8fcuv1008ilc0u4f9tfg9q` | TO DO | P1 | Show the client name in the Stage 2 order selector |
| `cmv8fcuwx008jlc0u38keclij` | TO DO | P1 | Notify the buyer when portal login email is missing |
| `cmv8fcuyn008klc0u60mvuoen` | TO DO | P1 | Add a reusable post-delivery order verifier |
| `cmv8fcv0d008llc0umqc0rj62` | TO DO | P1 | Finish lead return, credit, and replacement workflow |
| `cmv8fcv2a008mlc0uoiolle4s` | VERIFY | P0 | Keep client and niche submissions distinct from buyer suppression |
| `cmv8fcv4a008nlc0uv3ie95tl` | TO DO | P1 | Reconcile open draft PRs #158, #174, #175, and #176 |
| `cmv8fcv6g008olc0ug6nvq074` | VERIFY | P0 | Run the first controlled live buyer journey |

Vanessa stages 1–6 are acceptance criteria on the evidence card. Stages 7 and 8 are the two blocked approval and execution cards. They were not collapsed into a card that could be marked Done by locating a file.

### Blocked

| Title | Missing evidence or decision |
| --- | --- |
| Audit and finish DigitalOcean environment configuration | Legacy Meta alias and empty review settings. Owner: Sam. |
| Remove production `FACEBOOK_DIRECT_INTAKE_ENABLED=true` | Sam must change the flag. This reconciliation did not. |
| Record authentic Meta App Review permission videos | Blocked on the alias removal and empty review token/allowlists. |
| Separately approve a capture-only Meta lead canary | No separate approval. |
| Capture authentic `leads_retrieval` evidence | Blocked on that canary. |
| Confirm production migrations for operator review and external receipts | `_prisma_migrations` was not queried. |
| Reconcile Vanessa historical delivery evidence | Workbook not in the repo. Counts are user-reported. |
| Obtain explicit approval before the Vanessa receipt import | Not authorized. Owner: Sam. |
| Execute the approved Vanessa receipt import | Blocked on that approval. Import flag is false. |
| Run the first controlled live buyer journey | Blocked on migration evidence and the legacy Meta flag. |

### Deferred

The Later column stayed at 24 cards. "Aged Lead Orders" stayed there on purpose. No card was newly moved to Later.

### Duplicates avoided

These were updated instead of recreated:

- DigitalOcean environment cleanup
- Reservation transaction safety
- `fulfilledQuantity` / order lifecycle
- Buyer CSV State
- Aged-order placeholder
- Controlled live delivery canary

Checklist items for the inventory map and for Vanessa preparation are acceptance criteria on one card each, not a second set of near-duplicate titles.

### Not marked Done

Merged and deployed PRs #177, #178, and #179. The inventory map flag being true. LO-1055's operational follow-ups. Issue #51, #54, #71, #155. Meta dashboard registration. Migration application. The "SA360 Demo end-to-end delivery test" card was already Done with a residual note; it was left Done because this pass did not re-test that demo.

## What could not be updated

- Feature flags, secrets, migrations, Meta subscriptions, imports, billing, and deliveries. Out of scope, and not changed.
- Closing GitHub issues or pull requests. #158 was not closed.
- Draft PR #180. It remains a separate open draft. Its debug-route finding does not match the later active spec (`ENABLE_DEBUG_ROUTES=false` on the API; `GET /webhooks/ghl/test` returned 404). `/debug/test-event` was not called.
- A customer browser session for the inventory map.
- The Meta app dashboard.
- A production read of `_prisma_migrations`.
- Older Done/Doing cards from May–June 2026 that were not re-tested. They were left as operators had them.

## Safety

Authenticated Kanban create and update calls were the only production writes. No `sync-seed`. No direct SQL. No flag edits.
