# AI usage telemetry updater

Run this manually once a month from the repository root:

```bash
node scripts/update-ai-usage.mjs
```

Preview collection without writing files:

```bash
node scripts/update-ai-usage.mjs --dry-run
```

The updater reads local Codex and Claude Code logs through `ccusage@latest`
(override with `CCUSAGE_VERSION=<version>`), merges them into
`scripts/ai-usage-ledger.json`, and refreshes:

- `_data/ai_usage.json` for the Jekyll home page
- `assets/generated/ai-usage.svg` for the GitHub profile

## xAI usage exports

xAI usage (grok-bot, grok-chat, and Cursor billed through xAI) has no local
logs. Download the usage CSV from the xAI account and pass it in:

```bash
node scripts/update-ai-usage.mjs --xai-csv ~/Downloads/personal-unified-usage-YYYY-MM-DD.csv
```

Rows are grouped by KST day under the `xai` provider. On-demand rows use the
billed amount. Included (subscription) rows are priced at the rates in
`XAI_RATES`, which were backed out from on-demand rows and match the billed
amounts exactly. grok-bot rows carry no model name and bill at two rate sets,
so the higher one is used and its cost is an upper estimate. Image and audio
usage is not token-based and is skipped.

Exports are fixed billing records, so each day keeps the larger of the
recorded and imported totals. Overlapping exports never double-count, and an
export that covers only part of a day cannot lower it. The raw CSV contains
account identifiers; do not commit it.

## Codex compressed logs

Codex compresses older rollouts to `.jsonl.zst`, which `ccusage` 20.0.20 and
earlier do not read. The updater copies `sessions/` and `archived_sessions/` from
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
