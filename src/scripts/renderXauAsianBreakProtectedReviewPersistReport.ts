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
    executionConfig: {
        entryFeeBps: number;
        exitFeeBps: number;
        entrySlippageBps: number;
        exitSlippageBps: number;
        orderTiming: string;
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

function main() {
    const args = parseArgs(process.argv.slice(2));
    const reports = args.inputs.map((inputPath) => {
        const resolved = path.resolve(inputPath);
        return {
            inputPath: resolved,
            data: JSON.parse(fs.readFileSync(resolved, 'utf8')) as OutputFile,
        };
    });

    const runs = reports.flatMap((report) => report.data.createdRuns);
    const first = reports[0]!.data;

    const markdown = [
        '# XAU Protected Review Runs',
        '',
        '## Run Metadata',
        '',
        `- Generated at: \`${new Date().toISOString()}\``,
        `- Batch tag: \`${first.batchTag}\``,
        `- Symbol: \`${first.symbol}\``,
        `- Review window: \`${first.dateRange.from}\` -> \`${first.dateRange.to}\``,
        `- Execution: \`fee ${first.executionConfig.entryFeeBps}/${first.executionConfig.exitFeeBps} bps\`, \`slippage ${first.executionConfig.entrySlippageBps}/${first.executionConfig.exitSlippageBps} bps\`, \`${first.executionConfig.orderTiming}\``,
        '',
        '## Source Files',
        '',
        ...reports.map((report) => `- \`${report.inputPath}\` (${report.data.group}: ${report.data.groupLabel})`),
        '',
        '## Persisted Runs',
        '',
        '| Signal Code | Version | Run ID | Review Path | Net PnL | WR | PF | Max DD | Trades |',
        '| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |',
        ...runs.map((run) => `| \`${run.signalCode}\` | \`${run.signalVersion}\` | \`${run.backtestRunId}\` | \`${run.detailPath}\` | \`${run.summary.netPnl}\` | \`${run.summary.winRate}%\` | \`${run.summary.profitFactor ?? 'n/a'}\` | \`${run.summary.maxDd}%\` | \`${run.summary.trades}\` |`),
        '',
        '## Account-Level Risk',
        '',
        '| Signal Code | Max L Streak | Max Losing Days | Guard Activations | Blocked Entries | Equity DD USD | Equity DD % | Avg R | Median R |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...runs.map((run) => `| \`${run.signalCode}\` | \`${run.riskSummary.maxConsecutiveLosses}\` | \`${run.riskSummary.maxConsecutiveLosingDays}\` | \`${run.riskSummary.guardActivationCount}\` | \`${run.riskSummary.blockedEntryCount}\` | \`${run.riskSummary.equityCurveMaxDdUsd}\` | \`${run.riskSummary.equityCurveMaxDdPct}%\` | \`${run.riskSummary.avgRPerTrade}\` | \`${run.riskSummary.medianRPerTrade}\` |`),
        '',
        '## Notes',
        '',
        ...runs.map((run) => `- \`${run.signalCode}@${run.signalVersion}\`: ${run.notes}`),
    ].join('\n');

    const resolvedOut = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, markdown);
    console.log(`Saved markdown report to ${resolvedOut}`);
}

main();
