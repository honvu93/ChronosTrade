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
    atrMultiplier: number;
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
    const timeframeOrder = ['M5', 'M15', 'M30', 'H1'];
    return [...results].sort((left, right) => {
        const timeframeDiff = timeframeOrder.indexOf(left.timeframe) - timeframeOrder.indexOf(right.timeframe);
        if (timeframeDiff !== 0) {
            return timeframeDiff;
        }
        return left.atrMultiplier - right.atrMultiplier;
    });
}

function getReferenceMap(results: VariantResult[]) {
    return new Map(
        results
            .filter((row) => row.timeframe === 'M15' && row.atrMultiplier === 1.2)
            .map((row) => ['M15_BASE', row.summary]),
    );
}

function getTimeframeBaseMap(results: VariantResult[]) {
    return new Map(
        results
            .filter((row) => row.atrMultiplier === 1.2)
            .map((row) => [row.timeframe, row.summary]),
    );
}

function renderTable(
    results: VariantResult[],
    timeframeBaseMap: Map<string, Summary>,
    m15Base: Summary | null,
) {
    const header = [
        '| Variant | TF | ATR | Net PnL | Delta vs TF Base | Delta vs M15 Base | WR | Delta WR vs TF Base | Max DD | Delta DD vs TF Base | PF | Trades |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];

    const rows = results.map((row) => {
        const timeframeBase = timeframeBaseMap.get(row.timeframe) ?? null;
        const deltaVsTfBase = timeframeBase ? Number((row.summary.netPnl - timeframeBase.netPnl).toFixed(2)) : null;
        const deltaVsM15Base = m15Base ? Number((row.summary.netPnl - m15Base.netPnl).toFixed(2)) : null;
        const deltaWrVsTfBase = timeframeBase ? Number((row.summary.winRate - timeframeBase.winRate).toFixed(2)) : null;
        const deltaDdVsTfBase = timeframeBase ? Number((row.summary.maxDd - timeframeBase.maxDd).toFixed(2)) : null;

        return `| \`${row.variantId}\` | \`${row.timeframe}\` | \`${row.atrMultiplier}\` | \`${row.summary.netPnl}\` | \`${deltaVsTfBase ?? 'n/a'}\` | \`${deltaVsM15Base ?? 'n/a'}\` | \`${row.summary.winRate}%\` | \`${deltaWrVsTfBase ?? 'n/a'}\` | \`${row.summary.maxDd}%\` | \`${deltaDdVsTfBase ?? 'n/a'}\` | \`${row.summary.profitFactor ?? 'n/a'}\` | \`${row.summary.trades}\` |`;
    });

    return [...header, ...rows].join('\n');
}

function renderRiskTable(results: VariantResult[]) {
    const header = [
        '| Variant | TF | ATR | Max L Streak | Max Losing Days | Guard Activations | Blocked Entries | Equity DD USD | Equity DD % | Avg R | Median R |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];

    const rows = results.map((row) => (
        `| \`${row.variantId}\` | \`${row.timeframe}\` | \`${row.atrMultiplier}\` | \`${row.riskSummary.maxConsecutiveLosses}\` | \`${row.riskSummary.maxConsecutiveLosingDays}\` | \`${row.riskSummary.guardActivationCount}\` | \`${row.riskSummary.blockedEntryCount}\` | \`${row.riskSummary.equityCurveMaxDdUsd}\` | \`${row.riskSummary.equityCurveMaxDdPct}%\` | \`${row.riskSummary.avgRPerTrade}\` | \`${row.riskSummary.medianRPerTrade}\` |`
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
    const timeframeBaseMap = getTimeframeBaseMap(allResults);
    const m15Base = getReferenceMap(allResults).get('M15_BASE') ?? null;
    const topNetPnl = [...allResults].sort((left, right) => right.summary.netPnl - left.summary.netPnl).slice(0, 8);
    const topQuality = [...allResults]
        .filter((row) => row.summary.maxDd >= -7 && row.summary.winRate >= 40)
        .sort((left, right) => (right.summary.profitFactor ?? 0) - (left.summary.profitFactor ?? 0) || right.summary.netPnl - left.summary.netPnl)
        .slice(0, 8);

    const first = reports[0]!.data;
    const markdown = [
        '# XAU Asian Break Capital Protection Timeframe Matrix',
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
        '## Source Files',
        '',
        ...reports.map((report) => `- \`${report.inputPath}\` (${report.data.group}: ${report.data.groupLabel})`),
        '',
        '## M15 Protected Reference',
        '',
        m15Base
            ? renderTable(allResults.filter((row) => row.timeframe === 'M15' && row.atrMultiplier === 1.2), timeframeBaseMap, m15Base)
            : '_No `M15 ATR 1.2` row found. Delta vs M15 base will show `n/a`._',
        '',
        '## Full Protected Timeframe Matrix',
        '',
        renderTable(allResults, timeframeBaseMap, m15Base),
        '',
        '## Account-Level Risk',
        '',
        renderRiskTable(allResults),
        '',
        '## Top By Net PnL',
        '',
        renderTable(topNetPnl, timeframeBaseMap, m15Base),
        '',
        '## Top By Quality',
        '',
        topQuality.length > 0 ? renderTable(topQuality, timeframeBaseMap, m15Base) : '_No rows met the `WR >= 40%` and `Max DD >= -7%` filter._',
        '',
        '## Variant Change Notes',
        '',
        ...allResults.map((row) => `- \`${row.variantId}\`: ${row.changeSummary}`),
        '',
        '## Notes For Review',
        '',
        '- This file is machine-generated from chunked JSON runs.',
        '- Each timeframe includes the same capital-protection rules and the same `HARD_SIGNAL_TP` exit profile.',
        '- `windowBars` and `stopLookback` are scaled by timeframe so the London continuation recipe stays roughly equivalent in clock time.',
        '- H4 is intentionally excluded because the intraday London-session breakout becomes too coarse on 4-hour bars.',
    ].join('\n');

    const resolvedOut = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, markdown);
    console.log(`Saved markdown report to ${resolvedOut}`);
}

main();
