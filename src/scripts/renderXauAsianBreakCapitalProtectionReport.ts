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

type BacktestRiskSummary = {
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
    baseSignalCode: string;
    baseSignalName: string;
    timeframe: string;
    exitProfile: string;
    summary: Summary;
    riskSummary: BacktestRiskSummary;
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
        tradeGuards?: {
            lossStreakThrottle?: {
                steps?: Array<{
                    afterLosses: number;
                    riskPercent: number;
                }>;
            };
            sessionLossCap?: {
                maxLosses?: number;
                maxNetR?: number;
            };
            dayLossCap?: {
                maxLosses?: number;
                maxNetR?: number;
            };
        };
    };
    baseSignalCode: string;
    baseSignalName: string;
    results: VariantResult[];
};

const LEGACY_BASELINE = {
    netPnl: 110222.17,
    netR: 496.23,
    winRate: 42.95,
    maxDd: -3.59,
    profitFactor: 1.24,
    trades: 3565,
    riskPercent: 2,
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

function renderTable(results: VariantResult[], protectedBase: VariantResult | null) {
    const header = [
        '| Variant | Net PnL | Delta vs Protected Base | WR | Delta WR | Max DD | Delta DD | PF | Trades |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];

    const rows = results.map((row) => {
        const deltaPnl = protectedBase ? Number((row.summary.netPnl - protectedBase.summary.netPnl).toFixed(2)) : null;
        const deltaWr = protectedBase ? Number((row.summary.winRate - protectedBase.summary.winRate).toFixed(2)) : null;
        const deltaDd = protectedBase ? Number((row.summary.maxDd - protectedBase.summary.maxDd).toFixed(2)) : null;

        return `| \`${row.variantId}\` | \`${row.summary.netPnl}\` | \`${deltaPnl ?? 'n/a'}\` | \`${row.summary.winRate}%\` | \`${deltaWr ?? 'n/a'}\` | \`${row.summary.maxDd}%\` | \`${deltaDd ?? 'n/a'}\` | \`${row.summary.profitFactor ?? 'n/a'}\` | \`${row.summary.trades}\` |`;
    });

    return [...header, ...rows].join('\n');
}

function renderRiskTable(results: VariantResult[]) {
    const header = [
        '| Variant | Max L Streak | Max Losing Days | Guard Activations | Blocked Entries | Equity DD USD | Equity DD % | Avg R | Median R |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];

    const rows = results.map((row) => (
        `| \`${row.variantId}\` | \`${row.riskSummary.maxConsecutiveLosses}\` | \`${row.riskSummary.maxConsecutiveLosingDays}\` | \`${row.riskSummary.guardActivationCount}\` | \`${row.riskSummary.blockedEntryCount}\` | \`${row.riskSummary.equityCurveMaxDdUsd}\` | \`${row.riskSummary.equityCurveMaxDdPct}%\` | \`${row.riskSummary.avgRPerTrade}\` | \`${row.riskSummary.medianRPerTrade}\` |`
    ));

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
    const protectedBase = allResults.find((row) => row.variantId === 'guard_base_hard') ?? null;
    const topNetPnl = [...allResults].sort((left, right) => right.summary.netPnl - left.summary.netPnl).slice(0, 5);
    const topQuality = [...allResults]
        .filter((row) => row.summary.maxDd >= -7 && row.summary.winRate >= 40)
        .sort((left, right) => right.summary.profitFactor! - left.summary.profitFactor! || right.summary.netPnl - left.summary.netPnl)
        .slice(0, 5);

    const first = reports[0]!.data;
    const markdown = [
        '# XAU Asian Break Capital Protection Matrix',
        '',
        '## Run Metadata',
        '',
        `- Generated at: \`${new Date().toISOString()}\``,
        `- Review window: \`${first.from}\` -> \`${first.to}\``,
        `- Symbol: \`${first.symbol}\``,
        `- Base signal: \`${first.baseSignalCode}\``,
        `- Initial equity: \`${first.initialEquity} USD\``,
        `- Base risk per trade: \`${first.riskPercent}%\``,
        `- Execution: \`fee ${first.executionConfig.entryFeeBps}/${first.executionConfig.exitFeeBps} bps\`, \`slippage ${first.executionConfig.entrySlippageBps}/${first.executionConfig.exitSlippageBps} bps\`, \`${first.executionConfig.orderTiming}\``,
        '',
        '## Capital Protection Rules',
        '',
        `- Loss streak throttle: \`${(first.executionConfig.tradeGuards?.lossStreakThrottle?.steps ?? []).map((step) => `${step.afterLosses}L -> ${step.riskPercent}%`).join(', ') || 'none'}\``,
        `- Session loss cap: \`maxLosses=${first.executionConfig.tradeGuards?.sessionLossCap?.maxLosses ?? 'n/a'}\`, \`maxNetR=${first.executionConfig.tradeGuards?.sessionLossCap?.maxNetR ?? 'n/a'}\``,
        `- Day loss cap: \`maxLosses=${first.executionConfig.tradeGuards?.dayLossCap?.maxLosses ?? 'n/a'}\`, \`maxNetR=${first.executionConfig.tradeGuards?.dayLossCap?.maxNetR ?? 'n/a'}\``,
        '',
        '## Legacy Reference From XAU-06',
        '',
        '| Variant | Risk | Net PnL | Net R | WR | Max DD | PF | Trades |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        `| \`legacy_hard_unguarded\` | \`${LEGACY_BASELINE.riskPercent}%\` | \`${LEGACY_BASELINE.netPnl}\` | \`${LEGACY_BASELINE.netR}\` | \`${LEGACY_BASELINE.winRate}%\` | \`${LEGACY_BASELINE.maxDd}%\` | \`${LEGACY_BASELINE.profitFactor}\` | \`${LEGACY_BASELINE.trades}\` |`,
        '',
        '## Source Files',
        '',
        ...reports.map((report) => `- \`${report.inputPath}\` (${report.data.group}: ${report.data.groupLabel})`),
        '',
        '## Full Protected Matrix',
        '',
        renderTable(allResults, protectedBase),
        '',
        '## Account-Level Risk',
        '',
        renderRiskTable(allResults),
        '',
        '## Top By Net PnL',
        '',
        renderTable(topNetPnl, protectedBase),
        '',
        '## Top By Quality',
        '',
        topQuality.length > 0 ? renderTable(topQuality, protectedBase) : '_No rows met the `WR >= 40%` and `Max DD >= -7%` filter._',
        '',
        '## Variant Change Notes',
        '',
        ...allResults.map((row) => `- \`${row.variantId}\`: ${row.changeSummary}`),
        '',
        '## Notes For Review',
        '',
        '- This file is machine-generated from chunked JSON runs.',
        '- The protected matrix is intentionally run at `1%` base risk with throttle and kill switches enabled.',
        '- Compare first against `guard_base_hard`, then against the legacy unguarded XAU-06 baseline.',
    ].join('\n');

    const resolvedOut = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, markdown);
    console.log(`Saved markdown report to ${resolvedOut}`);
}

main();
