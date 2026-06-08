import fs from 'fs';
import path from 'path';

type Summary = {
    trades: number;
    netPnl: number;
    netR: number;
    winRate: number;
    maxDd: number;
    profitFactor: number | null;
};

type RiskSummary = {
    maxConsecutiveLosses: number;
    maxConsecutiveLosingDays: number;
    guardActivationCount: number;
    blockedEntryCount: number;
    equityCurveMaxDdUsd: number;
    equityCurveMaxDdPct: number;
    avgRPerTrade: number;
    medianRPerTrade: number;
};

type VariantResult = {
    variantId: string;
    variantLabel: string;
    timeframe: 'M15' | 'M30' | 'H1';
    exitProfile: string;
    changeSummary: string;
    summary: Summary;
    riskSummary: RiskSummary;
};

type OutputFile = {
    generatedAt: string;
    group: string;
    groupLabel: string;
    symbol: string;
    from: string;
    to: string;
    initialEquity: number;
    riskPercent: number;
    baseSignalCode: string;
    notes: string[];
    results: VariantResult[];
};

function parseArgs(argv: string[]) {
    let inputPath: string | null = null;
    let outPath: string | null = null;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--input') {
            inputPath = argv[index + 1] ?? null;
            index += 1;
            continue;
        }
        if (arg === '--out') {
            outPath = argv[index + 1] ?? null;
            index += 1;
            continue;
        }
        throw new Error(`Unknown argument "${arg}".`);
    }

    if (!inputPath || !outPath) {
        throw new Error('Usage: --input <json> --out <md>');
    }

    return { inputPath, outPath };
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const input = JSON.parse(fs.readFileSync(path.resolve(args.inputPath), 'utf8')) as OutputFile;
    const sorted = [...input.results].sort((left, right) => {
        if (left.timeframe !== right.timeframe) {
            return left.timeframe.localeCompare(right.timeframe);
        }
        return right.summary.netPnl - left.summary.netPnl;
    });

    const byTimeframe = new Map<string, VariantResult[]>();
    for (const row of sorted) {
        const bucket = byTimeframe.get(row.timeframe) ?? [];
        bucket.push(row);
        byTimeframe.set(row.timeframe, bucket);
    }

    const markdown = [
        '# XAU ABC Area-Cap Timeframe Expansion',
        '',
        '## Run Metadata',
        '',
        `- Generated at: \`${input.generatedAt}\``,
        `- Review window: \`${input.from}\` -> \`${input.to}\``,
        `- Symbol: \`${input.symbol}\``,
        `- Base signal: \`${input.baseSignalCode}\``,
        '',
        '## Results By Timeframe',
        '',
        ...Array.from(byTimeframe.entries()).flatMap(([timeframe, rows]) => [
            `### ${timeframe}`,
            '',
            '| Variant | Net PnL | WR | PF | Trades | Max L Streak | Eq DD |',
            '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
            ...rows.map((row) => `| \`${row.variantId}\` | \`${row.summary.netPnl}\` | \`${row.summary.winRate}%\` | \`${row.summary.profitFactor ?? 'n/a'}\` | \`${row.summary.trades}\` | \`${row.riskSummary.maxConsecutiveLosses}\` | \`${row.riskSummary.equityCurveMaxDdPct}%\` |`),
            '',
        ]),
        '## Variant Change Notes',
        '',
        ...sorted.map((row) => `- \`${row.variantId}\`: ${row.changeSummary}`),
        '',
        '## Batch Notes',
        '',
        ...input.notes.map((note) => `- ${note}`),
    ].join('\n');

    const resolved = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, markdown);
    console.log(`Saved markdown report to ${resolved}`);
}

main();
