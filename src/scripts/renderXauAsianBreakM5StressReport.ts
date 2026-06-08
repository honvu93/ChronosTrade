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
    candidateId: string;
    candidateLabel: string;
    changeSummary: string;
    timeframe: string;
    atrMultiplier: number;
    stressId: string;
    stressLabel: string;
    entryFeeBps: number;
    exitFeeBps: number;
    entrySlippageBps: number;
    exitSlippageBps: number;
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
    const stressOrder = ['baseline', 'stress_1', 'stress_2', 'stress_3'];
    return [...results].sort((left, right) => {
        if (left.candidateId !== right.candidateId) {
            return left.candidateId.localeCompare(right.candidateId);
        }
        return stressOrder.indexOf(left.stressId) - stressOrder.indexOf(right.stressId);
    });
}

function getBaselineMap(results: VariantResult[]) {
    return new Map(
        results
            .filter((row) => row.stressId === 'baseline')
            .map((row) => [row.candidateId, row]),
    );
}

function renderTable(results: VariantResult[], baselineMap: Map<string, VariantResult>) {
    const header = [
        '| Candidate | Stress | Net PnL | Delta PnL vs Baseline | WR | Delta WR | PF | Max DD | Equity DD % | Max L Streak | Guard Activations | Blocked Entries | Trades |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];

    const rows = results.map((row) => {
        const baseline = baselineMap.get(row.candidateId);
        const deltaPnl = baseline ? Number((row.summary.netPnl - baseline.summary.netPnl).toFixed(2)) : null;
        const deltaWr = baseline ? Number((row.summary.winRate - baseline.summary.winRate).toFixed(2)) : null;

        return `| \`${row.candidateId}\` | \`${row.stressId}\` | \`${row.summary.netPnl}\` | \`${deltaPnl ?? 'n/a'}\` | \`${row.summary.winRate}%\` | \`${deltaWr ?? 'n/a'}\` | \`${row.summary.profitFactor ?? 'n/a'}\` | \`${row.summary.maxDd}%\` | \`${row.riskSummary.equityCurveMaxDdPct}%\` | \`${row.riskSummary.maxConsecutiveLosses}\` | \`${row.riskSummary.guardActivationCount}\` | \`${row.riskSummary.blockedEntryCount}\` | \`${row.summary.trades}\` |`;
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
    const baselineMap = getBaselineMap(allResults);
    const stressPass = allResults.filter((row) => row.summary.winRate >= 50 && (row.summary.profitFactor ?? 0) > 1.4 && row.riskSummary.equityCurveMaxDdPct < 7);
    const first = reports[0]!.data;

    const markdown = [
        '# XAU Asian Break M5 Stress Matrix',
        '',
        '## Run Metadata',
        '',
        `- Generated at: \`${new Date().toISOString()}\``,
        `- Review window: \`${first.from}\` -> \`${first.to}\``,
        `- Symbol: \`${first.symbol}\``,
        `- Base signal: \`${first.baseSignalCode}\``,
        `- Initial equity: \`${first.initialEquity} USD\``,
        `- Base risk per trade: \`${first.riskPercent}%\``,
        '',
        '## Source Files',
        '',
        ...reports.map((report) => `- \`${report.inputPath}\` (${report.data.group}: ${report.data.groupLabel})`),
        '',
        '## Full Stress Matrix',
        '',
        renderTable(allResults, baselineMap),
        '',
        '## Passing Stress Rows',
        '',
        stressPass.length > 0 ? renderTable(stressPass, baselineMap) : '_No rows met the `WR > 50%`, `PF > 1.4`, and `equityCurveMaxDdPct < 7%` filter._',
        '',
        '## Notes For Review',
        '',
        '- This file is machine-generated from chunked JSON runs.',
        '- Compare each stress row against the baseline row for the same candidate.',
        '- Use this file to decide whether `M5` remains deployable or must stay research-only.',
    ].join('\n');

    const resolvedOut = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, markdown);
    console.log(`Saved markdown report to ${resolvedOut}`);
}

main();
