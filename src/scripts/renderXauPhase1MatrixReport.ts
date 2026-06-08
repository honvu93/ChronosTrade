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

type ExperimentResult = {
    seedCode: string;
    seedName: string;
    timeframe: string;
    exitProfile: string;
    summary: Summary;
};

type MatrixOutputFile = {
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
    candidates: string[];
    results: ExperimentResult[];
};

const EXIT_ORDER = [
    'HARD_SIGNAL_TP',
    'BE_1R_TP_2R',
    'PARTIAL_1R_BE_SWING_TRAIL',
    'XAU_NY_CLOSE',
];

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

function sortResults(results: ExperimentResult[]) {
    return [...results].sort((left, right) => {
        if (left.seedCode !== right.seedCode) {
            return left.seedCode.localeCompare(right.seedCode);
        }
        return EXIT_ORDER.indexOf(left.exitProfile) - EXIT_ORDER.indexOf(right.exitProfile);
    });
}

function renderTable(results: ExperimentResult[]) {
    const header = [
        '| Signal | Exit | TF | Net PnL | Net R | WR | Max DD | PF | Trades |',
        '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];
    const rows = results.map((row) => (
        `| \`${row.seedCode}\` | \`${row.exitProfile}\` | \`${row.timeframe}\` | \`${row.summary.netPnl}\` | \`${row.summary.netR}\` | \`${row.summary.winRate}%\` | \`${row.summary.maxDd}%\` | \`${row.summary.profitFactor ?? 'n/a'}\` | \`${row.summary.trades}\` |`
    ));

    return [...header, ...rows].join('\n');
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const reports = args.inputs.map((inputPath) => {
        const resolved = path.resolve(inputPath);
        return {
            inputPath: resolved,
            data: JSON.parse(fs.readFileSync(resolved, 'utf8')) as MatrixOutputFile,
        };
    });

    const allResults = sortResults(
        reports.flatMap((report) => report.data.results),
    );

    const topNetPnl = [...allResults]
        .sort((left, right) => right.summary.netPnl - left.summary.netPnl)
        .slice(0, 5);

    const topQuality = [...allResults]
        .filter((row) => row.summary.maxDd >= -7 && row.summary.winRate >= 50)
        .sort((left, right) => {
            if (right.summary.profitFactor !== left.summary.profitFactor) {
                return (right.summary.profitFactor ?? 0) - (left.summary.profitFactor ?? 0);
            }
            return right.summary.netPnl - left.summary.netPnl;
        })
        .slice(0, 5);

    const rejected = [...allResults]
        .filter((row) => row.summary.winRate < 40 || row.summary.maxDd < -7)
        .sort((left, right) => left.summary.winRate - right.summary.winRate || left.summary.maxDd - right.summary.maxDd);

    const first = reports[0]!.data;
    const markdown = [
        '# XAU Phase 1 Matrix Output',
        '',
        '## Run Metadata',
        '',
        `- Generated at: \`${new Date().toISOString()}\``,
        `- Review window: \`${first.from}\` -> \`${first.to}\``,
        `- Symbol: \`${first.symbol}\``,
        `- Initial equity: \`${first.initialEquity} USD\``,
        `- Risk per trade: \`${first.riskPercent}%\``,
        `- Execution: \`fee ${first.executionConfig.entryFeeBps}/${first.executionConfig.exitFeeBps} bps\`, \`slippage ${first.executionConfig.entrySlippageBps}/${first.executionConfig.exitSlippageBps} bps\`, \`${first.executionConfig.orderTiming}\``,
        '',
        '## Source Files',
        '',
        ...reports.map((report) => `- \`${report.inputPath}\` (${report.data.group}: ${report.data.groupLabel})`),
        '',
        '## Full Matrix',
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
        '## Rejected Candidates',
        '',
        rejected.length > 0 ? renderTable(rejected) : '_No rows were auto-flagged by the rejection filter._',
        '',
        '## Notes For Review',
        '',
        '- This file is machine-generated from chunked JSON runs.',
        '- Use it as the review handoff file back into Codex.',
        '- If a chunk is missing, rerun only that group and regenerate this report.',
    ].join('\n');

    const resolvedOut = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, markdown);
    console.log(`Saved markdown report to ${resolvedOut}`);
}

main();
