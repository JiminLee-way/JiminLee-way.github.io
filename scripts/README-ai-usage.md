# AI usage telemetry updater

Run this manually once a month from the repository root:

```bash
node scripts/update-ai-usage.mjs
```

Preview collection without writing files:

```bash
node scripts/update-ai-usage.mjs --dry-run
```

The updater reads local Codex and Claude Code logs through the pinned
`ccusage` version, merges them into `scripts/ai-usage-ledger.json`, and
refreshes:

- `_data/ai_usage.json` for the Jekyll home page
- `assets/generated/ai-usage.svg` for the GitHub profile

Codex compresses older rollouts to `.jsonl.zst`, which the pinned `ccusage`
does not read. The updater copies `sessions/` and `archived_sessions/` from
`CODEX_HOME` (default `~/.codex`) into a temporary directory, decompresses the
`.zst` files there, and points `ccusage` at that copy. The originals are not
modified. If a run would lower a day already in the ledger, the updater prints
a warning, since that usually means local logs are missing.

## Ledger

`scripts/ai-usage-ledger.json` keeps usage that local logs can no longer
provide:

- `baseline` holds fixed per-provider totals from a previous machine, counted
  through `baseline.through`. It is set by hand and never rewritten by the
  updater. Local rows dated on or before `baseline.through` are ignored.
- `daily` holds one row per `YYYY-MM-DD` and provider after the baseline.
  Rows stay in the ledger after the local logs are deleted (Claude Code prunes
  session logs older than 30 days by default).

Totals are `baseline` plus the sum of `daily`. Commit the ledger together with
the generated files.

## Duplicate protection

The updater does not append snapshots. Ledger rows use `date` + `provider` as
the unique key, so running it multiple times on the same day updates that
day's totals in place. Local logs replace ledger rows from the last 30 days;
older rows are kept as recorded, because their local logs may be partially
pruned. When the calculated data is identical, no file is rewritten.

The earliest measurement date is the minimum of the previous start date, the
baseline start date, and the earliest ledger date.

## Cost meaning

Cost is an estimate derived from model list prices. It is not an invoice,
subscription charge, or guaranteed savings amount.

## Git behavior

This updater does not call `git add`, `git commit`, or `git push`. Review and
publish the generated files manually when desired.
