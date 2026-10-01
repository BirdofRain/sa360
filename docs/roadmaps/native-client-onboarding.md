# Native client onboarding roadmap

This roadmap keeps onboarding inside Admin C.O.C. **Clients & Subaccounts** and keeps
`ClientAccount` as the client registry. A setup request is administrative metadata; it never
authorizes intake-stage changes, routing, allocation, delivery, or live activation.

## Stage 1 — Native client setup and improved account creation (this PR)

**Dependencies:** existing Admin C.O.C. session/admin API key boundary, `ClientAccount`,
SourceFunnel vocabulary, and existing niche/product values.

**Acceptance criteria:** name-first creation with a stable suggested/manual account ID; accessible
multi-value niche/product selection including legacy and validated admin-added values; draft setup
persistence and review states; explicit source-proof and destination-request capture; append-only
change audit; server-enforced admin writes; no observer, portal, or anonymous mutations; no
operational side effects.

**Boundary:** a requested provider or destination is not an implemented adapter or configured
destination. No spreadsheets, emails, invitations, routing rules, SourceFunnel associations, or
delivery targets are created. Setup review remains separate from source receipt, exact client
association, destination verification, and activation.

**Rollout:** the structured setup view and API default off behind
`SA360_NATIVE_CLIENT_SETUP_ENABLED=true`, enforced in both apps. The improved account form and
existing client configuration remain available while disabled.

**Lifecycle and integrity:** the setup document is mutable configuration metadata and is deleted
with its `ClientAccount`; append-only setup audit events survive setup/client deletion with the
historical client identity retained. Rekey moves the live setup and current audit attribution while
preserving that original identity. Save request IDs bind to client, intent, payload, and loaded
revision. `submittedAt` means the latest successful submission of the current reviewed content; a
later content-changing draft save returns the setup to draft and clears submission/review stamps.

## Stage 2 — Team identities, invitations, and simplified workspace

**Dependencies:** an Auth/Account design for staff identities, memberships, session revocation,
and record visibility; confirmation of current Admin C.O.C. auth semantics. Google Drive OAuth is
not Google sign-in.

**Acceptance criteria:** invite `matt@lifeagentlaunch.com`, `aaron@lifeagentlaunch.com`, and
`alex@lifeagentlaunch.com` using Sam-controlled, expiring, single-use invitations; password setup
and Google sign-in only after implementing the actual sign-in capability; server-enforced
permissions; client-setup-focused navigation; account disabling and session revocation; preserved
admin and observer workflows.

**Boundary:** do not reuse permissions from the Sites prototype without an SA360 authorization
review. Do not expose customer-portal sessions as staff sessions or broaden observer access.

## Stage 3 — Google Drive/Sheets connection and ownership

**Dependencies:** existing per-client Google OAuth token encryption/refresh and Sheets destination
foundation; a connection ownership and staff authorization model from Stage 2; Shared Drive rules.

**Acceptance criteria:** select an existing spreadsheet or create one in the explicitly selected
connected account; show Google identity plus ownership/access implications before creation; prefer
Matt or Aaron ownership where selected; clearly separate C.O.C. login identity from Drive
connection; support secure unattended delivery after logout; isolate refresh-token use; handle
revocation, reconnect, staff departure, and moved/deleted sheets; respect Shared Drive ownership;
never overwrite existing data, tabs, or headers automatically; retries never create duplicate
spreadsheets; verify write access independently because a URL is not proof.

**Boundary:** never default ownership to Sam or a service account. A setup request does not connect,
create, share, or verify a file.

## Stage 4 — Resend onboarding alerts

**Dependencies:** existing transactional email helper, a durable outbox/status model, and an
idempotent event emitted after committed setup creation/submission.

**Acceptance criteria:** alert `sam@lifeagentlaunch.com` and `samuel.hebda@gmail.com`; verified
domain `sa360.lifeagentlaunch.com`; proposed sender
`SA360 <notifications@sa360.lifeagentlaunch.com>`; reply-to `sam@lifeagentlaunch.com`; distinguish
new-setup and later submission notifications where useful; ordinary saves/retries do not duplicate
alerts; durable retry/status ensures email failure never loses client data.

**Boundary:** no real email is sent by Stage 1. Reuse email infrastructure rather than adding a
second sender.

## Stage 5 — Source proof and controlled delivery readiness

**Dependencies:** merged PRs #150/#151 source-intake trace contracts, SourceFunnel association
confirmation, and destination-specific readiness services.

**Acceptance criteria:** correlate exact source identifiers and fail closed on ambiguity; use a
genuine source-generated UUID/time as evidence; keep canonical inventory reuse distinct from source
ownership/client attribution; confirm source receipt and exact client association separately;
verify GHL and Sheets independently; require separate reviewed actions for routing and delivery
activation.

**Boundary:** onboarding must not change intake stages, normalization, dedupe, inventory
eligibility, source ownership, routing, allocation, or delivery. A generic synthetic webhook test
is not final source proof.

## Stage 6 — Migration from the Sites prototype

**Dependencies:** inventory of prototype records, identity matching rules, ownership approval, and
an auditable reconciliation plan.

**Acceptance criteria:** reconcile every real record to an SA360 `ClientAccount` or an explicit
exception; preserve source evidence and ownership; validate counts and conflicts before retirement.

**Boundary:** do not delete or modify the prototype until reconciliation is reviewed and approved.
