import fs from 'fs';
import path from 'path';

type RunSummary = {
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

type PersistedReviewRun = {
    signalDefinitionId: string;
    signalCode: string;
    signalVersion: number;
    signalName: string;
    backtestRunId: string;
    detailPath: string;
    notes: string;
    variantId: string;
    family: 'm5_capped' | 'tf_protected';
    timeframe: 'M5' | 'M15' | 'M30' | 'H1';
    riskPercent: number;
    summary: RunSummary;
    riskSummary: BacktestRiskSummary;
};

type OutputFile = {
    generatedAt: string;
    group: string;
    groupLabel: string;
    batchTag: string;
    symbol: string;
    dateRange: {
        from: string;
        to: string;
    };
    createdRuns: PersistedReviewRun[];
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

function sortRuns(runs: PersistedReviewRun[]) {
    const timeframeOrder = ['M5', 'M15', 'M30', 'H1'];
    const familyOrder = ['m5_capped', 'tf_protected'];
    return [...runs].sort((left, right) => {
        const familyDiff = familyOrder.indexOf(left.family) - familyOrder.indexOf(right.family);
        if (familyDiff !== 0) {
            return familyDiff;
        }
        const timeframeDiff = timeframeOrder.indexOf(left.timeframe) - timeframeOrder.indexOf(right.timeframe);
        if (timeframeDiff !== 0) {
            return timeframeDiff;
        }
        return right.summary.netPnl - left.summary.netPnl;
    });
}

function buildRunTable(runs: PersistedReviewRun[]) {
    return [
        '| Variant | Family | TF | Risk | Net PnL | WR | PF | Max DD | Trades | Run ID |',
        '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
        ...runs.map((run) => (
            `| \`${run.variantId}\` | \`${run.family}\` | \`${run.timeframe}\` | \`${run.riskPercent}%\` | \`${run.summary.netPnl}\` | \`${run.summary.winRate}%\` | \`${run.summary.profitFactor ?? 'n/a'}\` | \`${run.summary.maxDd}%\` | \`${run.summary.trades}\` | \`${run.backtestRunId}\` |`
        )),
    ].join('\n');
}

function buildRiskTable(runs: PersistedReviewRun[]) {
    return [
        '| Variant | Max L Streak | Max Losing Days | Guard Activations | Blocked Entries | Equity DD USD | Equity DD % | Avg R | Median R |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...runs.map((run) => (
            `| \`${run.variantId}\` | \`${run.riskSummary.maxConsecutiveLosses}\` | \`${run.riskSummary.maxConsecutiveLosingDays}\` | \`${run.riskSummary.guardActivationCount}\` | \`${run.riskSummary.blockedEntryCount}\` | \`${run.riskSummary.equityCurveMaxDdUsd}\` | \`${run.riskSummary.equityCurveMaxDdPct}%\` | \`${run.riskSummary.avgRPerTrade}\` | \`${run.riskSummary.medianRPerTrade}\` |`
        )),
    ].join('\n');
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const reports = args.inputs.map((inputPath) => {
        const resolvedPath = path.resolve(inputPath);
        return {
            inputPath: resolvedPath,
            data: JSON.parse(fs.readFileSync(resolvedPath, 'utf8')) as OutputFile,
        };
    });

    const runs = sortRuns(reports.flatMap((report) => report.data.createdRuns));
    const first = reports[0]!.data;
    const topPnl = [...runs].sort((left, right) => right.summary.netPnl - left.summary.netPnl).slice(0, 5);
    const topQuality = [...runs]
        .sort((left, right) => (
            (left.riskSummary.equityCurveMaxDdPct - right.riskSummary.equityCurveMaxDdPct)
            || (right.summary.winRate - left.summary.winRate)
            || (right.summary.netPnl - left.summary.netPnl)
        ))
        .slice(0, 5);

    const markdown = [
        '# XAU Area-Cap Next Review Runs',
        '',
        '## Run Metadata',
        '',
        `- Generated at: \`${new Date().toISOString()}\``,
        `- Batch tag: \`${first.batchTag}\``,
        `- Symbol: \`${first.symbol}\``,
        `- Review window: \`${first.dateRange.from}\` -> \`${first.dateRange.to}\``,
        '',
        '## Source Files',
        '',
        ...reports.map((report) => `- \`${report.inputPath}\` (${report.data.group}: ${report.data.groupLabel})`),
        '',
        '## Persisted Runs',
        '',
        buildRunTable(runs),
        '',
        '## Account-Level Risk',
        '',
        buildRiskTable(runs),
        '',
        '## Top By Net PnL',
        '',
        buildRunTable(topPnl),
        '',
        '## Top By Safety / Quality',
        '',
        buildRunTable(topQuality),
        '',
        '## Review Paths',
        '',
        ...runs.map((run) => `- \`${run.signalCode}@${run.signalVersion}\`: \`${run.detailPath}\``),
        '',
        '## Notes',
        '',
        ...runs.map((run) => `- \`${run.variantId}\`: ${run.notes}`),
    ].join('\n');

    const resolvedOut = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, markdown);
    console.log(`Saved markdown report to ${resolvedOut}`);
}

main();
