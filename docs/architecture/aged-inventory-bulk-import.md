# Aged Inventory Bulk Import CLI

Service-direct full-file onboarding for Vet/Trucker master CSVs.

## Commands

```bash
pnpm inventory:bulk-aged -- --mode preview|commit|resume|reconcile ...
```

Operational verification / bulk activation land in the stacked PR
`feature/aged-inventory-operational-verification-v1`.

## Guarantees

- Streaming CSV reader (no HTTP body limit)
- Deterministic content source IDs (`aged-v1-*`) — not row/chunk/path based
- File SHA-256 snapshot registry with completed-snapshot idempotency
- Checkpoint/resume with identity-index rebuild
- Items land in `pending_review`
- PULLED / Used By retained internally; never buyer-visible; never exclude-only reasons
- Lead Type = campaign label only; niche from `--default-niche`
- Buyer CSV allowlist unchanged: `first_name,last_name,phone,email,state,lead_date,niche`

## Identity policy

| Case | Disposition |
| --- | --- |
| Exact content source ID duplicate | skip |
| Phone/email pair conflict (merged people) | quarantine |
| No usable phone or email | reject |
| Valid phone + invalid email | retain + email issue |
| Same identity, different lead date | separate inventory rows |
| Email-only (no phone) | accept (canonical email identity) |

## Operational verification

See stacked PR `feature/aged-inventory-operational-verification-v1`.
