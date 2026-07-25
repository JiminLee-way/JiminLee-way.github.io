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
`ccusage` version and refreshes:

- `_data/ai_usage.json` for the Jekyll home page
- `assets/generated/ai-usage.svg` for the GitHub profile

## Duplicate protection

The updater does not append snapshots. It rebuilds usage from the local logs
and combines records using `YYYY-MM-DD` as the unique key. Running it multiple
times on the same day updates that day's totals in place. When the calculated
data is identical, neither output file is rewritten.

The earliest measurement date is preserved as the minimum of the previous
start date and the earliest date still present in local logs.

## Cost meaning

Cost is an estimate derived from model list prices. It is not an invoice,
subscription charge, or guaranteed savings amount.

## Git behavior

This updater does not call `git add`, `git commit`, or `git push`. Review and
publish the generated files manually when desired.
