# Association correction confirmation

This is the pure snapshot contract for a future association-only correction. It does not add a route, a writer, a migration, or a production flag. The unsigned preview digest from `GET /admin/v1/facebook-source-resolution/association-correction-preview` is not authorization.

## Transient HTTP 500

Production request `req-33` on 2026-11-09 at 10:54:35 AM ET (`15:54:35.834Z`) was the third preview of the JR Laird cohort in one burst. It returned HTTP 500 at 10:54:40 AM ET. The API log records Prisma `P2028`:

`Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 5045 ms passed since the start of the transaction.`

The expired statement was `lifecycleEvent.findMany()` inside `loadRelationEvidence`. The interactive transaction uses Prisma's default 5000 ms timeout. The same Page and Form later returned HTTP 200 for offset 200, including a limit of 100, with the same digest. The log shows no `too many clients`, no statement timeout from Postgres, and no restart of the API instance. The failure is explained. It is not reproducible on a single request of this cohort. It appears when the sequential read exceeds five seconds.

The read-only transaction runs about 30 statements: the candidate query, 21 event-id lookups, the external-receipt lookup, routing, delivery-plan, duplicate-risk, and lifecycle lookups, Meta dispatch and failed-dispatch lookups, a second lifecycle lookup, and the duplicate-identity count. `LifecycleEvent.leadUid` has no index. `MetaDispatchAttempt.eventUuid` has no index. Those scans sit inside the five-second budget. The transaction is `READ ONLY`, and the following database check showed no funnel, event, audit, or downstream change.

This is a reliability failure, not a data-integrity failure. The request aborted before a response and wrote nothing.

Recommended remediation, not included here: pass `timeout: 15_000` on this read-only transaction only. Do not add a flag or a migration for that change. A later, separately authorized migration can index `LifecycleEvent.leadUid` and `MetaDispatchAttempt.eventUuid` if the read still approaches the new budget. Do not raise the timeout and then run the preview in a tight loop.

## Snapshot contract

`signConfirmationSnapshot` and `verifyConfirmationSnapshot` are pure. The signer builds version `1` with purpose `facebook_association_correction`.

The signed body binds:

- SourceFunnel id, Page id, Form id, and origin client
- the operator cutoff `confirmedAt`
- the preview digest, as a reference only
- the exact event count
- each eligible event id and its 16-hex preview fingerprint, sorted by event id
- issued-at and expiry exactly 15 minutes later
- acknowledgement `association_only`

The HMAC is SHA-256 over the canonical JSON, using `SA360_ASSOCIATION_CORRECTION_SNAPSHOT_SECRET`. The reader ignores `ADMIN_API_KEY` and `SA360_ADMIN_KEY`. The secret is not logged and is not required for the current preview. Verification compares SHA-256 digests of the provided and expected signatures with `timingSafeEqual`.

Verification rejects an unknown version, a body that is not already in canonical event order, a count that disagrees with the event array, any acknowledgement other than `association_only`, a bad signature, an issued-at in the future, an expiry at or before now, and any difference in funnel, page, form, origin, cutoff, digest, event id, or fingerprint. Adding, dropping, or substituting an event fails even when the signature is valid for a different set. A bare preview digest is malformed.

## Actor identity

`x-sa360-admin-key` proves possession of the shared admin secret. It does not name a person. `x-sa360-operator` is client-supplied text. Any holder of the admin key can set it to any value, so it is not an authorization boundary and must not be treated as one.

A future audit record, which this change does not create, may store the request id, the snapshot signature prefix, the funnel, the origin, the Page, the Form, the sorted event ids, the fingerprints, the acknowledgement, and the issued-at and expiry. The authenticated subject is the shared admin credential, recorded as a label such as `admin_api_key`, never the key itself. The operator header may be stored only as an unauthenticated label beside that subject. A named person requires a separate staff identity. Until that exists, a correction attempt has one authenticated actor: the admin credential.

## Future locked execution

This section is a contract for a later writer. This branch does not implement it.

One transaction performs the whole attempt. The lock order matches locks that already exist:

1. Funnel advisory lock `fb-form:facebook:${providerFunnelId}`, the same key `confirmFacebookFormAssociation` uses.
2. Canonical lead advisory locks from `buildCanonicalSourceLeadLockKey`, in sorted `sourceLeadId` order.
3. `FOR UPDATE` on the SourceFunnel row, then on each SourceLeadEvent id in sorted id order.

Inside those locks the writer reloads the SourceFunnel and rechecks every current eligibility blocker. A changed fingerprint, a changed owner, a failed blocker, or an expired or future-issued snapshot rejects the whole attempt. The HMAC is verified again with the server secret. There is no partial association update: the transaction commits every intended row or none.

Idempotency: if every selected event is already associated to the signed origin, the attempt returns unchanged and does not append another audit entry. A retry after a commit sees that state. A crash before commit leaves the previous state.

The only future writes are the resolved client, the association object, one append to `associationAudit`, and the normalized association. The writer does not change status and does not call reevaluation, routing, Graph, GHL, Sheets, CAPI, inventory, or dispatch. It does not hold the locks across an outbound request.

## Blockers before a single-event writer

- The preview transaction timeout is still the Prisma default of five seconds.
- No snapshot secret is provisioned, and this branch must not provision one.
- There is still no person-level actor. A writer must not promote `x-sa360-operator` into authentication.
- The lock, recheck, and idempotent write above are not implemented.
- Indexing `LifecycleEvent.leadUid` needs its own migration approval.
