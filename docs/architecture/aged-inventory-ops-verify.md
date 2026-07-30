# Aged Inventory Operational Verification

Stacked on the bulk import CLI. Enables lot-scale technical verification and
activation without per-row admin clicks after source masters are business-approved.

## Phrases

- Verify: `VERIFY AGED INVENTORY LOT`
- Activate: `MAKE REVIEWED INVENTORY AVAILABLE`

## Truthful scope

May verify:

- source row normalized
- valid generated date / niche / state
- usable name
- usable phone and/or email
- no exact source duplicate
- no disqualifying identity conflict
- no configured protected-agent exclusion (count is zero when none configured)

Must **not** claim:

- TCPA consent verification
- TrustedForm proof
- buyer delivery proof
- source ownership proof

## Commands

```bash
pnpm inventory:bulk-aged -- --mode verify --lot-key <lot> --request-id <id> \
  --expected-db-host <host:port> --operator <name> \
  --confirmation "VERIFY AGED INVENTORY LOT"

pnpm inventory:bulk-aged -- --mode activate --lot-key <lot> --request-id <id> \
  --expected-db-host <host:port> --operator <name> \
  --confirmation "MAKE REVIEWED INVENTORY AVAILABLE"
```

Import remains `pending_review` until verify+activate. No automatic activation on import.
