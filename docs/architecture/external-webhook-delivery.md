# External webhook delivery foundation

Baseline `848f86c9`. This document is the receiver and receipt contract for the third fresh-lead destination. It does not enable delivery. `SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED` stays unset unless a later change sets it to the exact string `true`.

The foundation stores one destination per client and one frozen receipt per source lead. It does not POST, does not start a worker, and does not add a lead-data GET route.

## Destinations

| Destination | Table | Role |
| --- | --- | --- |
| GHL location API | `ClientGhlDestination` | Primary CRM when live, cut over, internally approved, and the saved location is non-blank. The predicate is `isPersistedLiveDestination`. |
| External webhook | `ClientExternalWebhookDestination` | Primary CRM when `enabled` is true. Kind is `ghl_inbound` or `external_https`. |
| Company Sheets | `CompanySheetsDestination` | Parallel. Campaign dispatch is not a primary CRM arm. |
| Legacy custom webhook | `ClientCustomWebhookDestination` | Separate LF2 simulate path. This product does not set `enabled` on that row. |

`ghl_inbound` is a client-owned GoHighLevel inbound webhook URL. `external_https` is a Make scenario or another HTTPS endpoint the client operates. Both kinds are primary CRM. A client cannot have the live GHL location API armed and this row enabled at the same time. The database rejects that pair with `duplicate_primary_crm`. Sheets may run beside either primary CRM. Enabling this row does not set `ClientGhlDestination.deliveryEnabled`, `CompanySheetsDestination.campaignDispatchEnabled`, or `DeliveryTarget.enabled`.

The endpoint URL and the optional HMAC secret are AES-256-GCM ciphertext under `SA360_EXTERNAL_WEBHOOK_CREDENTIAL_KEY`. That key is not `SA360_CUSTOM_WEBHOOK_SECRET_KEY` and it is not a Meta, GHL, or Google token key. Reads return `endpointHost` only.

A URL or secret change must advance `revision`. An open attempt keeps the revision, host, and URL fingerprint it copied at insert.

## Idempotency and mapping

```text
external-webhook:{clientAccountId}:{sourceLeadEventId}
```

One attempt per client and source lead. The unique key is that string. A second insert for the same lead conflicts. Retries of a `retryable` attempt send the stored `payloadCanonicalJson` bytes. They do not call `findPublishedColumnMap` again.

Mapping mode is one of:

- `v3_canonical` — `fields` are the company Sheets v3 source fields from `companySheetsCampaignRowValues`. `columnMapId` is null.
- `published_column_map` — the caller passes the row `findPublishedColumnMap` would return (published funnel scope, otherwise published shared). `columnMapContentKey` is `column-map:{id}:v{version}` from `columnMapContentKey`. `fields` are the mapped cells from `customRowProjection`.

`dobAge` is `projectCampaignDobAge` for the same lead. `dateOfBirth` stays `YYYY-MM-DD` and is not shifted to America/New_York. Supplied age stays. A conflict stays on `dobAge.conflict` and in `warnings`. An age does not create a birthday. Aged-inventory 18–120 and max-86 gates are not applied.

In `v3_canonical`, `fields.date_of_birth` and `fields.consumer_age` equal `dobAge.dateOfBirth` and `dobAge.age`. In a published map, `fields.date_of_birth` is the sheet cell. A `date_america_new_york` transform may write `MM/DD/YYYY` there. Receivers that need the canonical birthday read `dobAge.dateOfBirth`.

`payloadSha256` is the hex SHA-256 of the canonical JSON (object keys sorted, UTF-8, no extra whitespace).

## Receipt

| Observation | `outcome` | Retried later |
| --- | --- | --- |
| No HTTP status, request never left, including a timeout before send | `retryable` | Yes, same bytes |
| Timeout, connection loss, 3xx, 408, 429, or 5xx after the bytes left | `uncertain` | No |
| 2xx | `http_accepted` | No |
| Other 4xx | `failed` | No |

`http_accepted` proves only `http_2xx`. Every receipt's `doesNotProve` is:

```json
["ghl_contact","ghl_workflow","ghl_note","ghl_location_api_success","sheets_row_appended","sms_sent","email_sent"]
```

A 2xx is not a location-API contact, workflow, or note. The sender must not follow redirects (`maxRedirects` 0). A 3xx is `uncertain`.

`recorded` means the payload is stored and the request has not left. `attempted` means a receipt was classified. Frozen columns cannot change. `http_accepted`, `failed`, and `uncertain` cannot be rewritten. `retryable` may be classified once.

## What the receiver gets

`POST` `application/json; charset=utf-8`. The body is the frozen canonical JSON. Headers:

| Header | Value |
| --- | --- |
| `X-SA360-Contract` | `sa360.external_webhook.lead.v1` |
| `X-SA360-Idempotency-Key` | `external-webhook:{clientAccountId}:{sourceLeadEventId}` |
| `X-SA360-Mapping-Mode` | `v3_canonical` or `published_column_map` |
| `X-SA360-Mapping-Content-Key` | content key, or empty for v3 |
| `X-SA360-Destination-Kind` | `ghl_inbound` or `external_https` |
| `X-SA360-Destination-Revision` | destination revision copied onto the attempt |
| `X-SA360-Signature` | `sha256=` plus hex HMAC-SHA256 of the raw body. Omitted when auth mode is `none`. |

The body is not a GHL contact-upsert payload and it does not contain GHL custom-field UUIDs.

### GoHighLevel inbound webhook

The client pastes the inbound webhook URL from the workflow trigger. The path is the credential. Auth mode stays `none`. SA360 does not create the contact through the location API.

Map workflow fields from the JSON:

- `fields.full_name`, `fields.first_name`, `fields.last_name`
- `fields.phone`, `fields.email`, `fields.state`
- `dobAge.dateOfBirth` for the birthday
- `fields.consumer_age` for age
- `idempotencyKey` if the workflow needs to ignore a duplicate POST

Respond `2xx` only after the trigger has accepted the body. That status does not tell SA360 that a contact, note, or workflow enrollment exists. Those remain GHL's job inside the workflow the client built.

### Make

Use a custom webhook trigger. Deduplicate on `idempotencyKey`. Read `fields` for the sheet-shaped values and `columns` when the scenario needs header order. When the destination auth mode is `hmac_sha256`, verify `X-SA360-Signature` over the raw body before accepting. A later duplicate of an accepted key should return `2xx` and do no second write. SA360 will not automatically retry an `uncertain` result.

## URL safety

`validateExternalWebhookUrl` refuses non-HTTPS, userinfo, fragments, localhost and other internal names, obfuscated IP literals, and any literal or resolved address in a private, loopback, link-local, CGNAT, documentation, or metadata range. One private answer rejects the whole set. The resolver is injected. This package does not call DNS by itself during tests.

The later sender resolves again immediately before connect, refuses redirects, and uses a 10 second timeout.

## SMS preference

`ClientDeliveryNotificationPreference` keeps channel `email`. Three columns are reserved for a later sender and do not send:

- `recipientPhoneE164` — operator E.164, not the consumer's phone
- `recipientPhoneVerifiedAt`
- `smsEnabled` — default false, and true only with the phone and the verification timestamp

The email on/off check is unchanged.

## Future authenticated GET

Not implemented. A later admin route may be:

`GET /api/admin/clients/:clientAccountId/external-webhook-attempts/:idempotencyKey`

Admin key only. It would return the frozen `payloadCanonicalJson` and the receipt. It would not return the endpoint URL, would not re-project the lead, and would not POST. It is not a public lead-data route. Portal, observer, and workspace keys are not this path.

## Sender and acceptance event

A recorded attempt is claimed to `sending` before the socket opens. The POST connects only to one address returned by a fresh `validateExternalWebhookUrl` call. `lookup` returns that address and `autoSelectFamily` is off, so a later DNS answer cannot move the connection. TLS still uses the original hostname. Redirects are destroyed and stored as `uncertain`.

If `destination.revision`, `endpointUrlFingerprint`, `endpointHost`, or `kind` no longer matches the attempt, the sender stores `failed` and does not decrypt or POST. A crashed `sending` row older than 120 seconds is promoted to `uncertain` and is not POSTed again.

`SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED` must be the exact string `true` before scheduling and again before any resolver or socket call. The queue is `external-webhook-delivery`, separate from Sheets and GHL.

Lane B reads a persisted `http_accepted` attempt through `externalWebhookAcceptanceEvent`:

```ts
{
  acceptanceId: string; // the attempt id
  clientAccountId: string;
  sourceLeadEventId: string;
  destinationId: string;
  attemptId: string;
  httpStatus: number;
  acceptedAt: string; // ISO time of the accepted-state write
}
```

This path does not send email or SMS.

## Lane B dependencies

Pure modules, no sender:

- `apps/api/src/lib/external-webhook-url-policy.ts`
- `apps/api/src/lib/external-webhook-credentials.ts`
- `apps/api/src/services/external-webhook/external-webhook-contract.ts`
- `apps/api/src/services/external-webhook/external-webhook-payload.ts`

Tables: `ClientExternalWebhookDestination`, `ExternalWebhookDeliveryAttempt`.

Preference columns: `recipientPhoneE164`, `recipientPhoneVerifiedAt`, `smsEnabled`.

The intake hook, queue, and sender are a later change. They insert `buildExternalWebhookAttemptRecord` inside the lead transaction and classify with `classifyExternalWebhookResponse`. A configuration miss returns. A database error is the only throw that can roll the lead back.
