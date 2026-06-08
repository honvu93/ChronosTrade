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
    changeSummary: string;
    exitProfile: string;
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
    results: VariantResult[];
    notes: string[];
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

function renderResultRows(rows: VariantResult[]) {
    return [
        '| Variant | Net PnL | Net R | WR | PF | Trades | Max DD | Max L Streak | Eq DD |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...rows.map((row) => `| \`${row.variantId}\` | \`${row.summary.netPnl}\` | \`${row.summary.netR}\` | \`${row.summary.winRate}%\` | \`${row.summary.profitFactor ?? 'n/a'}\` | \`${row.summary.trades}\` | \`${row.summary.maxDd}%\` | \`${row.riskSummary.maxConsecutiveLosses}\` | \`${row.riskSummary.equityCurveMaxDdPct}%\` |`),
    ].join('\n');
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const input = JSON.parse(fs.readFileSync(path.resolve(args.inputPath), 'utf8')) as OutputFile;
    const sorted = [...input.results].sort((left, right) => right.summary.netPnl - left.summary.netPnl);
    const bestPnL = sorted[0] ?? null;
    const bestSafety = [...input.results].sort((left, right) => (
        left.riskSummary.maxConsecutiveLosses - right.riskSummary.maxConsecutiveLosses
        || left.riskSummary.equityCurveMaxDdPct - right.riskSummary.equityCurveMaxDdPct
        || right.summary.netPnl - left.summary.netPnl
    ))[0] ?? null;

    const markdown = [
        '# XAU ABC M5 Area-Cap Round 2',
        '',
        '## Run Metadata',
        '',
        `- Generated at: \`${input.generatedAt}\``,
        `- Review window: \`${input.from}\` -> \`${input.to}\``,
        `- Symbol: \`${input.symbol}\``,
        `- Base signal: \`${input.baseSignalCode}\``,
        `- Risk per trade: \`${input.riskPercent}%\``,
        '',
        '## Results',
        '',
        renderResultRows(sorted),
        '',
        '## Verdict',
        '',
        ...(bestPnL ? [`- Best Net PnL: \`${bestPnL.variantId}\` -> \`${bestPnL.summary.netPnl}\``] : []),
        ...(bestSafety ? [`- Best streak safety: \`${bestSafety.variantId}\` -> \`maxL=${bestSafety.riskSummary.maxConsecutiveLosses}\`, \`eqDD=${bestSafety.riskSummary.equityCurveMaxDdPct}%\``] : []),
        '',
        '## Change Notes',
        '',
        ...input.results.map((row) => `- \`${row.variantId}\`: ${row.changeSummary}`),
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
