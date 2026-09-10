# Aged Inventory Bulk Import CLI

Service-direct full-file onboarding for Vet/Trucker master CSVs and the additive
`leadcapture_nextgen_export_v1` historical NextGen CSV adapter.

## Commands

```bash
pnpm inventory:bulk-aged -- --mode preview|commit|resume|reconcile ...
```

LeadCapture NextGen historical preview (local DB only; never production):

```bash
pnpm inventory:bulk-aged -- \
  --mode preview \
  --file /secure/path/outside-git/nextgen-export.csv \
  --source-format leadcapture_nextgen_export_v1 \
  --default-niche vet \
  --work-dir /secure/path/outside-git/work \
  --expected-file-sha256 <sha256-of-file> \
  --expected-db-host 127.0.0.1 \
  --operator <name>
```

Operational verification / bulk activation land in the stacked PR
`feature/aged-inventory-operational-verification-v1`.

## Guarantees

- Streaming CSV reader (no HTTP body limit)
- Master formats use deterministic content source IDs (`aged-v1-*`) — not row/chunk/path based
- NextGen export preserves LeadCapture `Lead #` as `sourceLeadId` (never a generated replacement)
- File SHA-256 snapshot registry with completed-snapshot idempotency
- Checkpoint/resume with identity-index rebuild
- Items land in `pending_review`
- PULLED / Used By retained internally; never buyer-visible; never exclude-only reasons
- Lead Type / Funnel Name = campaign/funnel provenance only; niche from `--default-niche`
- Buyer CSV allowlist unchanged: `first_name,last_name,phone,email,state,lead_date,niche`

## Identity policy

| Case | Disposition |
| --- | --- |
| Exact content source ID duplicate (Master hash, or NextGen Lead #) | skip |
| Phone/email pair conflict (merged people) | quarantine |
| No usable phone or email | reject |
| Valid phone + invalid email | retain + email issue |
| Same identity, different lead date | separate inventory rows (Master hash); NextGen Lead # is the identity |
| Email-only (no phone) | accept (canonical email identity) |

## Operational verification

See stacked PR `feature/aged-inventory-operational-verification-v1`.
