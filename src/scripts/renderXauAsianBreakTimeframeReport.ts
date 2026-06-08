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
    return [...results].sort((left, right) => {
        if (left.timeframe !== right.timeframe) {
            return left.timeframe.localeCompare(right.timeframe);
        }
        return left.exitProfile.localeCompare(right.exitProfile);
    });
}

function getReferenceMap(results: VariantResult[]) {
    return new Map(
        results
            .filter((row) => row.timeframe === 'M15')
            .map((row) => [row.exitProfile, row.summary]),
    );
}

function renderTable(results: VariantResult[], referenceByExit: Map<string, Summary>) {
    const header = [
        '| Variant | TF | Exit | Net PnL | Delta PnL vs M15 | WR | Delta WR vs M15 | Max DD | Delta DD vs M15 | PF | Trades |',
        '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];

    const rows = results.map((row) => {
        const reference = referenceByExit.get(row.exitProfile);
        const deltaPnl = reference ? Number((row.summary.netPnl - reference.netPnl).toFixed(2)) : null;
        const deltaWr = reference ? Number((row.summary.winRate - reference.winRate).toFixed(2)) : null;
        const deltaDd = reference ? Number((row.summary.maxDd - reference.maxDd).toFixed(2)) : null;

        return `| \`${row.variantId}\` | \`${row.timeframe}\` | \`${row.exitProfile}\` | \`${row.summary.netPnl}\` | \`${deltaPnl ?? 'n/a'}\` | \`${row.summary.winRate}%\` | \`${deltaWr ?? 'n/a'}\` | \`${row.summary.maxDd}%\` | \`${deltaDd ?? 'n/a'}\` | \`${row.summary.profitFactor ?? 'n/a'}\` | \`${row.summary.trades}\` |`;
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
    const referenceByExit = getReferenceMap(allResults);

    const topNetPnl = [...allResults].sort((left, right) => right.summary.netPnl - left.summary.netPnl).slice(0, 5);
    const topQuality = [...allResults]
        .filter((row) => row.summary.maxDd >= -7 && row.summary.winRate >= 50)
        .sort((left, right) => right.summary.winRate - left.summary.winRate || right.summary.netPnl - left.summary.netPnl)
        .slice(0, 5);

    const first = reports[0]!.data;
    const markdown = [
        '# XAU Asian Break Continuation Timeframe Matrix',
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
        '## Source Files',
        '',
        ...reports.map((report) => `- \`${report.inputPath}\` (${report.data.group}: ${report.data.groupLabel})`),
        '',
        '## M15 Reference Rows',
        '',
        referenceByExit.size > 0
            ? renderTable(allResults.filter((row) => row.timeframe === 'M15'), referenceByExit)
            : '_No M15 chunk found. Delta columns below will show `n/a`._',
        '',
        '## Full Timeframe Matrix',
        '',
        renderTable(allResults, referenceByExit),
        '',
        '## Top 5 By Net PnL',
        '',
        renderTable(topNetPnl, referenceByExit),
        '',
        '## Top 5 By Quality',
        '',
        topQuality.length > 0 ? renderTable(topQuality, referenceByExit) : '_No rows met the `WR >= 50%` and `Max DD >= -7%` filter._',
        '',
        '## Variant Change Notes',
        '',
        ...allResults.map((row) => `- \`${row.variantId}\`: ${row.changeSummary}`),
        '',
        '## Notes For Review',
        '',
        '- This file is machine-generated from chunked JSON runs.',
        '- `M15` is included as the in-batch reference lane for delta comparisons.',
        '- Timeframe tuning keeps the signal window and structure lookback roughly equivalent in clock time across M5/M15/M30/H1.',
        '- H4 is intentionally excluded because an intraday London-session breakout recipe becomes too coarse on 4-hour bars.',
    ].join('\n');

    const resolvedOut = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, markdown);
    console.log(`Saved markdown report to ${resolvedOut}`);
}

main();
