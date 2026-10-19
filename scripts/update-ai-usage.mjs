#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CCUSAGE_VERSION = process.env.CCUSAGE_VERSION || "20.0.20";
const TIME_ZONE = "Asia/Seoul";
// Claude Code deletes session logs older than this by default (cleanupPeriodDays).
const LOG_RETENTION_DAYS = 30;
const PROVIDERS = [
    { id: "codex", label: "Codex" },
    { id: "claude", label: "Claude Code" },
];

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const dataPath = resolve(repositoryRoot, "_data", "ai_usage.json");
const ledgerPath = resolve(scriptDirectory, "ai-usage-ledger.json");
const svgPath = resolve(
    repositoryRoot,
    "assets",
    "generated",
    "ai-usage.svg",
);

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

if (args.has("--help") || args.has("-h")) {
    console.log(`
Usage:
  node scripts/update-ai-usage.mjs
  node scripts/update-ai-usage.mjs --dry-run

Reads local Codex and Claude Code logs through ccusage, merges them into
scripts/ai-usage-ledger.json, then refreshes:
  _data/ai_usage.json
  assets/generated/ai-usage.svg

The script never runs git add, commit, or push.
Running it repeatedly on the same day is idempotent: daily values are
recomputed by date, not appended.
`.trim());
    process.exit(0);
}

function runCcusage(provider) {
    const commandArgs = [
        "--yes",
        `ccusage@${CCUSAGE_VERSION}`,
        provider.id,
        "daily",
        "--json",
        "--order",
        "asc",
    ];

    const result = spawnSync("npx", commandArgs, {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
            ...process.env,
            NO_COLOR: "1",
        },
        maxBuffer: 100 * 1024 * 1024,
    });

    if (result.error) {
        throw new Error(
            `Could not start ccusage for ${provider.label}: ${result.error.message}`,
        );
    }

    if (result.status !== 0) {
        const detail = (result.stderr || result.stdout || "Unknown error")
            .trim()
            .slice(0, 600);
        throw new Error(
            `ccusage failed for ${provider.label} (exit ${result.status}): ${detail}`,
        );
    }

    let payload;
    try {
        payload = JSON.parse(result.stdout);
    } catch {
        throw new Error(
            `ccusage returned invalid JSON for ${provider.label}.`,
        );
    }

    const rows = payload.daily ?? payload.data;
    if (!Array.isArray(rows)) {
        throw new Error(
            `Unsupported ccusage JSON schema for ${provider.label}.`,
        );
    }

    return rows.map((row) => normalizeRow(row, provider));
}

function normalizeRow(row, provider) {
    const date = row.date ?? row.period;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(
            `Invalid daily date in ${provider.label} ccusage output.`,
        );
    }

    const totalTokens = toNonNegativeInteger(
        row.totalTokens ??
            sumNumbers(
                row.inputTokens,
                row.outputTokens,
                row.cacheCreationTokens,
                row.cacheReadTokens,
            ),
        `${provider.label} totalTokens`,
    );

    const totalCostUSD = toNonNegativeNumber(
        row.totalCost ?? row.costUSD ?? 0,
        `${provider.label} totalCost`,
    );

    return {
        date,
        provider: provider.id,
        totalTokens,
        totalCostUSD,
    };
}

function toNonNegativeInteger(value, fieldName) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new Error(`Invalid ${fieldName}: ${value}`);
    }
    return Math.round(number);
}

function toNonNegativeNumber(value, fieldName) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new Error(`Invalid ${fieldName}: ${value}`);
    }
    return number;
}

function sumNumbers(...values) {
    return values.reduce((sum, value) => sum + Number(value || 0), 0);
}

function roundCurrency(value) {
    return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function formatCompactTokens(value) {
    return new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 2,
    }).format(value);
}

function formatFullTokens(value) {
    return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

function zonedParts(date) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);

    return Object.fromEntries(
        parts
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value]),
    );
}

function dateKeyInSeoul(date) {
    const parts = zonedParts(date);
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function timestampInSeoul(date) {
    const parts = zonedParts(date);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+09:00`;
}

function timestampDisplayInSeoul(date) {
    const parts = zonedParts(date);
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} KST`;
}

function readPreviousData() {
    if (!existsSync(dataPath)) {
        return null;
    }

    try {
        return JSON.parse(readFileSync(dataPath, "utf8"));
    } catch {
        throw new Error(
            `_data/ai_usage.json exists but is not valid JSON. Fix or remove it before updating.`,
        );
    }
}

function readLedger() {
    if (!existsSync(ledgerPath)) {
        return { schemaVersion: 1, baseline: null, daily: [] };
    }

    let ledger;
    try {
        ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    } catch {
        throw new Error(
            `scripts/ai-usage-ledger.json exists but is not valid JSON. Fix it before updating.`,
        );
    }

    if (!Array.isArray(ledger.daily)) {
        throw new Error(
            `scripts/ai-usage-ledger.json is missing its daily array.`,
        );
    }

    return ledger;
}

function mergeLedgerRows(ledger, localRows, now) {
    const baselineThrough = ledger.baseline?.through ?? "";
    const finalizedBefore = dateKeyInSeoul(
        new Date(now.getTime() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    );
    const rows = new Map(
        ledger.daily.map((row) => [`${row.date}|${row.provider}`, row]),
    );

    for (const row of localRows) {
        if (row.date <= baselineThrough) {
            continue;
        }

        // Older days may be partially pruned locally; keep the recorded value.
        const key = `${row.date}|${row.provider}`;
        if (rows.has(key) && row.date < finalizedBefore) {
            continue;
        }

        rows.set(key, {
            ...row,
            totalCostUSD: roundCurrency(row.totalCostUSD),
        });
    }

    return [...rows.values()].sort(
        (a, b) =>
            a.date.localeCompare(b.date) ||
            a.provider.localeCompare(b.provider),
    );
}

function aggregate(rows, previousData, baseline, now) {
    const byDate = new Map();
    const providerTotals = new Map(
        PROVIDERS.map((provider) => [
            provider.id,
            {
                id: provider.id,
                label: provider.label,
                totalTokens:
                    baseline?.providers?.[provider.id]?.totalTokens ?? 0,
                totalCostUSD:
                    baseline?.providers?.[provider.id]?.totalCostUSD ?? 0,
            },
        ]),
    );

    for (const row of rows) {
        const daily = byDate.get(row.date) ?? {
            date: row.date,
            totalTokens: 0,
            totalCostUSD: 0,
        };
        daily.totalTokens += row.totalTokens;
        daily.totalCostUSD += row.totalCostUSD;
        byDate.set(row.date, daily);

        const provider = providerTotals.get(row.provider);
        provider.totalTokens += row.totalTokens;
        provider.totalCostUSD += row.totalCostUSD;
    }

    const allDates = [...byDate.keys()].sort();
    if (allDates.length === 0) {
        throw new Error("No Codex or Claude Code usage rows were found.");
    }

    const measurementStartedAt = [
        previousData?.measurementStartedAt,
        baseline?.measurementStartedAt,
        allDates[0],
    ]
        .filter(
            (date) =>
                typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date),
        )
        .sort()[0];

    const totalTokens = [...providerTotals.values()].reduce(
        (sum, provider) => sum + provider.totalTokens,
        0,
    );
    const totalCostUSD = roundCurrency(
        [...providerTotals.values()].reduce(
            (sum, provider) => sum + provider.totalCostUSD,
            0,
        ),
    );

    const todayKey = dateKeyInSeoul(now);
    const today = new Date(`${todayKey}T00:00:00+09:00`);
    const last30DateKeys = Array.from({ length: 30 }, (_, index) => {
        const daysAgo = 29 - index;
        return dateKeyInSeoul(
            new Date(today.getTime() - daysAgo * 24 * 60 * 60 * 1000),
        );
    });

    const last30Rows = last30DateKeys.map((date) => {
        const row = byDate.get(date);
        return {
            date,
            totalTokens: row?.totalTokens ?? 0,
            totalCostUSD: roundCurrency(row?.totalCostUSD ?? 0),
        };
    });

    const chartMaximum = Math.max(
        0,
        ...last30Rows.map((row) => row.totalTokens),
    );

    const daily30 = last30Rows.map((row) => ({
        ...row,
        totalTokensFormatted: formatFullTokens(row.totalTokens),
        intensity:
            row.totalTokens === 0 || chartMaximum === 0
                ? 0
                : Math.max(
                      1,
                      Math.min(
                          5,
                          Math.ceil((row.totalTokens / chartMaximum) * 5),
                      ),
                  ),
    }));

    const providers = [...providerTotals.values()].map((provider) => ({
        ...provider,
        totalCostUSD: roundCurrency(provider.totalCostUSD),
        totalTokensFormatted: formatCompactTokens(provider.totalTokens),
        totalCostFormatted: formatCurrency(provider.totalCostUSD),
    }));

    const activeProviders = providers
        .filter((provider) => provider.totalTokens > 0)
        .map((provider) => provider.label);
    const activeDays30 = daily30.filter(
        (row) => row.totalTokens > 0,
    ).length;

    return {
        schemaVersion: 1,
        measurementStartedAt,
        measurementStartedAtDisplay: measurementStartedAt,
        generatedAt: timestampInSeoul(now),
        generatedAtDisplay: timestampDisplayInSeoul(now),
        source: "ccusage local logs",
        scope: activeProviders,
        scopeDisplay: activeProviders.join(" + "),
        disclosure: "SELF-REPORTED · LOCAL LOGS",
        costDisclosure:
            "ESTIMATED FROM MODEL LIST PRICES · NOT ACTUAL BILLING",
        totals: {
            totalTokens,
            totalTokensFormatted: formatCompactTokens(totalTokens),
            totalTokensFull: formatFullTokens(totalTokens),
            totalCostUSD,
            totalCostFormatted: formatCurrency(totalCostUSD),
            activeDays30,
        },
        providers,
        daily30,
    };
}

function measurementSnapshot(data) {
    return JSON.stringify({
        measurementStartedAt: data.measurementStartedAt,
        totals: data.totals,
        providers: data.providers,
        daily30: data.daily30,
    });
}

function preserveTimestampWhenUnchanged(nextData, previousData) {
    if (
        previousData &&
        measurementSnapshot(nextData) === measurementSnapshot(previousData) &&
        typeof previousData.generatedAt === "string" &&
        typeof previousData.generatedAtDisplay === "string"
    ) {
        return {
            ...nextData,
            generatedAt: previousData.generatedAt,
            generatedAtDisplay: previousData.generatedAtDisplay,
        };
    }

    return nextData;
}

function xmlEscape(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function renderSvg(data) {
    const barHeights = [2, 7, 14, 22, 31, 42];
    const bars = data.daily30
        .map((day, index) => {
            const width = 16;
            const step = 23.7;
            const x = 36 + index * step;
            const height = barHeights[day.intensity];
            const y = 187 - height;
            const opacity = day.intensity === 0 ? 0.16 : 0.35 + day.intensity * 0.13;
            return `<rect x="${x.toFixed(1)}" y="${y}" width="${width}" height="${height}" fill="#00FF41" opacity="${opacity.toFixed(2)}"><title>${xmlEscape(day.date)}: ${xmlEscape(day.totalTokensFormatted)} tokens</title></rect>`;
        })
        .join("\n        ");

    const accessibleDescription = [
        `Measured since ${data.measurementStartedAtDisplay}.`,
        `${data.totals.totalTokensFull} total tokens.`,
        `${data.totals.totalCostFormatted} estimated cost in US dollars.`,
        data.costDisclosure,
    ].join(" ");

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="220" viewBox="0 0 800 220" role="img" aria-labelledby="title description">
    <title id="title">Jimin Lee AI compute telemetry</title>
    <desc id="description">${xmlEscape(accessibleDescription)}</desc>
    <defs>
        <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#30363D" stroke-width="1" opacity="0.35"/>
        </pattern>
        <style>
            text {
                font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-variant-numeric: tabular-nums;
            }
        </style>
    </defs>
    <rect x="0.5" y="0.5" width="799" height="219" fill="#0D1117" stroke="#30363D"/>
    <rect x="1" y="1" width="798" height="218" fill="url(#grid)"/>
    <rect x="20" y="18" width="760" height="184" fill="#161B22" stroke="#30363D"/>

    <circle cx="37" cy="36" r="4" fill="#00FF41"/>
    <text x="50" y="41" fill="#F0F6FC" font-size="14" font-weight="700">[AI_COMPUTE_TELEMETRY]</text>
    <text x="764" y="41" fill="#8B949E" font-size="10" text-anchor="end">${xmlEscape(data.disclosure)}</text>

    <text x="36" y="76" fill="#8B949E" font-size="10" letter-spacing="1.2">MEASURED SINCE</text>
    <text x="36" y="107" fill="#F0F6FC" font-size="24" font-weight="700">${xmlEscape(data.measurementStartedAtDisplay)}</text>

    <text x="290" y="76" fill="#8B949E" font-size="10" letter-spacing="1.2">TOTAL TOKENS</text>
    <text x="290" y="107" fill="#00FF41" font-size="28" font-weight="700">${xmlEscape(data.totals.totalTokensFormatted)}</text>

    <text x="545" y="76" fill="#8B949E" font-size="10" letter-spacing="1.2">EST. COST (USD)</text>
    <text x="545" y="107" fill="#F0F6FC" font-size="28" font-weight="700">${xmlEscape(data.totals.totalCostFormatted)}</text>

    <text x="36" y="137" fill="#8B949E" font-size="9" letter-spacing="1">RECENT 30 DAYS</text>
    ${bars}

    <text x="36" y="198" fill="#8B949E" font-size="9">${xmlEscape(data.scopeDisplay)}</text>
    <text x="764" y="198" fill="#8B949E" font-size="9" text-anchor="end">UPDATED ${xmlEscape(data.generatedAtDisplay)}</text>
</svg>
`;
}

function writeIfChanged(path, content) {
    const previousContent = existsSync(path)
        ? readFileSync(path, "utf8")
        : null;

    if (previousContent === content) {
        return "unchanged";
    }

    if (!dryRun) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, "utf8");
    }

    return dryRun ? "would update" : "updated";
}

function main() {
    console.log(`Collecting usage with ccusage ${CCUSAGE_VERSION}...`);
    const localRows = PROVIDERS.flatMap((provider) => {
        const rows = runCcusage(provider);
        console.log(`  ${provider.label}: ${rows.length} daily rows`);
        return rows;
    });

    const now = new Date();
    const ledger = readLedger();
    const ledgerRows = mergeLedgerRows(ledger, localRows, now);
    const previousData = readPreviousData();
    const aggregated = aggregate(
        ledgerRows,
        previousData,
        ledger.baseline,
        now,
    );
    const data = preserveTimestampWhenUnchanged(aggregated, previousData);

    const ledgerContent = `${JSON.stringify({ ...ledger, daily: ledgerRows }, null, 2)}\n`;
    const jsonContent = `${JSON.stringify(data, null, 2)}\n`;
    const svgContent = renderSvg(data);

    const ledgerStatus = writeIfChanged(ledgerPath, ledgerContent);
    const dataStatus = writeIfChanged(dataPath, jsonContent);
    const svgStatus = writeIfChanged(svgPath, svgContent);

    console.log(`\nMeasurement started: ${data.measurementStartedAtDisplay}`);
    console.log(
        `Total tokens: ${data.totals.totalTokensFull} (${data.totals.totalTokensFormatted})`,
    );
    console.log(`Estimated cost: ${data.totals.totalCostFormatted}`);
    console.log(`Active days (30d): ${data.totals.activeDays30}`);
    console.log(`Ledger: ${ledgerStatus}`);
    console.log(`Data file: ${dataStatus}`);
    console.log(`SVG card: ${svgStatus}`);
    console.log("\nNo Git commands were run.");
}

try {
    main();
} catch (error) {
    console.error(`\nAI usage update failed: ${error.message}`);
    process.exit(1);
}
