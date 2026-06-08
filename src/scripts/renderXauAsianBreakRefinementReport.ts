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

type VariantResult = {
    variantId: string;
    variantLabel: string;
    changeSummary: string;
    baseSignalCode: string;
    baseSignalName: string;
    timeframe: string;
    exitProfile: string;
    summary: Summary;
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
    executionConfig: {
        entryFeeBps: number;
        exitFeeBps: number;
        entrySlippageBps: number;
        exitSlippageBps: number;
        orderTiming: string;
    };
    baseSignalCode: string;
    baseSignalName: string;
    results: VariantResult[];
};

const BASELINES: Record<string, Summary> = {
    HARD_SIGNAL_TP: {
        trades: 3565,
        netPnl: 110222.17,
        netR: 496.23,
        winRate: 42.95,
        maxDd: -3.59,
        profitFactor: 1.24,
    },
    PARTIAL_1R_BE_SWING_TRAIL: {
        trades: 3565,
        netPnl: 10724.51,
        netR: 52.48,
        winRate: 56.16,
        maxDd: -3.59,
        profitFactor: 1.03,
    },
};

function parseArgs(argv: string[]) {
    const inputs: string[] = [];
    let outPath: string | null = null;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--inputs') {
            for (let pointer = index + 1; pointer < argv.length; pointer += 1) {
                if (argv[pointer].startsWith('--')) {
                    index = pointer - 1;
                    break;
                }
                inputs.push(argv[pointer]);
                index = pointer;
            }
            continue;
        }

        if (arg === '--out') {
            const value = argv[index + 1];
            if (!value) {
                throw new Error('--out requires a filepath.');
            }
            outPath = value;
            index += 1;
            continue;
        }

        throw new Error(`Unknown argument "${arg}".`);
    }

    if (inputs.length === 0) {
        throw new Error('Provide at least one JSON file via --inputs.');
    }

    if (!outPath) {
        throw new Error('Provide an output path via --out.');
    }

    return { inputs, outPath };
}

function sortResults(results: VariantResult[]) {
    return [...results].sort((left, right) => left.variantId.localeCompare(right.variantId));
}

function renderTable(results: VariantResult[]) {
    const header = [
        '| Variant | Exit | Net PnL | Delta PnL | WR | Delta WR | Max DD | Delta DD | PF | Trades |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];

    const rows = results.map((row) => {
        const baseline = BASELINES[row.exitProfile];
        const deltaPnl = baseline ? Number((row.summary.netPnl - baseline.netPnl).toFixed(2)) : null;
        const deltaWr = baseline ? Number((row.summary.winRate - baseline.winRate).toFixed(2)) : null;
        const deltaDd = baseline ? Number((row.summary.maxDd - baseline.maxDd).toFixed(2)) : null;

        return `| \`${row.variantId}\` | \`${row.exitProfile}\` | \`${row.summary.netPnl}\` | \`${deltaPnl ?? 'n/a'}\` | \`${row.summary.winRate}%\` | \`${deltaWr ?? 'n/a'}\` | \`${row.summary.maxDd}%\` | \`${deltaDd ?? 'n/a'}\` | \`${row.summary.profitFactor ?? 'n/a'}\` | \`${row.summary.trades}\` |`;
    });

    return [...header, ...rows].join('\n');
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const reports = args.inputs.map((inputPath) => {
        const resolved = path.resolve(inputPath);
        return {
            inputPath: resolved,
            data: JSON.parse(fs.readFileSync(resolved, 'utf8')) as OutputFile,
        };
    });

    const allResults = sortResults(reports.flatMap((report) => report.data.results));
    const topNetPnl = [...allResults].sort((left, right) => right.summary.netPnl - left.summary.netPnl).slice(0, 5);
    const topQuality = [...allResults]
        .filter((row) => row.summary.maxDd >= -7 && row.summary.winRate >= 50)
        .sort((left, right) => right.summary.winRate - left.summary.winRate || right.summary.netPnl - left.summary.netPnl)
        .slice(0, 5);

    const first = reports[0]!.data;
    const markdown = [
        '# XAU Asian Break Continuation Refinement Output',
        '',
        '## Run Metadata',
        '',
        `- Generated at: \`${new Date().toISOString()}\``,
        `- Review window: \`${first.from}\` -> \`${first.to}\``,
        `- Symbol: \`${first.symbol}\``,
        `- Base signal: \`${first.baseSignalCode}\``,
        `- Initial equity: \`${first.initialEquity} USD\``,
        `- Risk per trade: \`${first.riskPercent}%\``,
        `- Execution: \`fee ${first.executionConfig.entryFeeBps}/${first.executionConfig.exitFeeBps} bps\`, \`slippage ${first.executionConfig.entrySlippageBps}/${first.executionConfig.exitSlippageBps} bps\`, \`${first.executionConfig.orderTiming}\``,
        '',
        '## Reference Baselines From XAU-06',
        '',
        '| Exit | Net PnL | Net R | WR | Max DD | PF | Trades |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        `| \`HARD_SIGNAL_TP\` | \`${BASELINES.HARD_SIGNAL_TP.netPnl}\` | \`${BASELINES.HARD_SIGNAL_TP.netR}\` | \`${BASELINES.HARD_SIGNAL_TP.winRate}%\` | \`${BASELINES.HARD_SIGNAL_TP.maxDd}%\` | \`${BASELINES.HARD_SIGNAL_TP.profitFactor}\` | \`${BASELINES.HARD_SIGNAL_TP.trades}\` |`,
        `| \`PARTIAL_1R_BE_SWING_TRAIL\` | \`${BASELINES.PARTIAL_1R_BE_SWING_TRAIL.netPnl}\` | \`${BASELINES.PARTIAL_1R_BE_SWING_TRAIL.netR}\` | \`${BASELINES.PARTIAL_1R_BE_SWING_TRAIL.winRate}%\` | \`${BASELINES.PARTIAL_1R_BE_SWING_TRAIL.maxDd}%\` | \`${BASELINES.PARTIAL_1R_BE_SWING_TRAIL.profitFactor}\` | \`${BASELINES.PARTIAL_1R_BE_SWING_TRAIL.trades}\` |`,
        '',
        '## Source Files',
        '',
        ...reports.map((report) => `- \`${report.inputPath}\` (${report.data.group}: ${report.data.groupLabel})`),
        '',
        '## Full Variant Table',
        '',
        renderTable(allResults),
        '',
        '## Top 5 By Net PnL',
        '',
        renderTable(topNetPnl),
        '',
        '## Top 5 By Quality',
        '',
        topQuality.length > 0 ? renderTable(topQuality) : '_No rows met the `WR >= 50%` and `Max DD >= -7%` filter._',
        '',
        '## Variant Change Notes',
        '',
        ...allResults.map((row) => `- \`${row.variantId}\`: ${row.changeSummary}`),
        '',
        '## Notes For Review',
        '',
        '- This file is machine-generated from chunked JSON runs.',
        '- Deltas are calculated against the current XAU-06 Asian Break baseline for the same exit profile.',
        '- Send this markdown file back into Codex for the next review pass.',
    ].join('\n');

    const resolvedOut = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, markdown);
    console.log(`Saved markdown report to ${resolvedOut}`);
}

main();
