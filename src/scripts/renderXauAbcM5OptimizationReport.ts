import fs from 'fs';
import path from 'path';
import { M5_BASELINES, OutputFile, Summary, VariantResult } from './xauAbcOptimizationShared';

function parseArgs(argv: string[]) {
    const inputs: string[] = [];
    let dirPath: string | null = null;
    let outPath: string | null = null;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--dir') {
            const value = argv[index + 1];
            if (!value) {
                throw new Error('--dir requires a folder path.');
            }
            dirPath = value;
            index += 1;
            continue;
        }

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

    if (!dirPath && inputs.length === 0) {
        throw new Error('Provide either --dir or at least one input via --inputs.');
    }

    if (!outPath) {
        throw new Error('Provide an output path via --out.');
    }

    return { dirPath, inputs, outPath };
}

function getReference(exitProfile: string): { label: string; summary: Summary } {
    if (exitProfile === 'PARTIAL_1R_BE_SWING_TRAIL') {
        return {
            label: 'M5 swing',
            summary: M5_BASELINES.PARTIAL_1R_BE_SWING_TRAIL,
        };
    }

    return {
        label: 'M5 hard',
        summary: M5_BASELINES.HARD_SIGNAL_TP,
    };
}

function calcExpectancy(summary: Summary) {
    return summary.trades > 0 ? Number((summary.netR / summary.trades).toFixed(4)) : 0;
}

function sortResults(results: VariantResult[]) {
    return [...results].sort((left, right) => left.variantId.localeCompare(right.variantId));
}

function renderTable(results: VariantResult[]) {
    const header = [
        '| Variant | Exit | Ref Lane | Net PnL | Delta PnL | Net R | Exp R/Trade | WR | Max DD | PF | Trades |',
        '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];

    const rows = results.map((row) => {
        const reference = getReference(row.exitProfile);
        const deltaPnl = Number((row.summary.netPnl - reference.summary.netPnl).toFixed(2));

        return `| \`${row.variantId}\` | \`${row.exitProfile}\` | \`${reference.label}\` | \`${row.summary.netPnl}\` | \`${deltaPnl}\` | \`${row.summary.netR}\` | \`${calcExpectancy(row.summary)}\` | \`${row.summary.winRate}%\` | \`${row.summary.maxDd}%\` | \`${row.summary.profitFactor ?? 'n/a'}\` | \`${row.summary.trades}\` |`;
    });

    return [...header, ...rows].join('\n');
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const inputPaths = args.dirPath
        ? fs.readdirSync(path.resolve(args.dirPath))
            .filter((entry) => entry.endsWith('.json'))
            .sort((left, right) => left.localeCompare(right))
            .map((entry) => path.join(path.resolve(args.dirPath as string), entry))
        : args.inputs.map((inputPath) => path.resolve(inputPath));

    if (inputPaths.length === 0) {
        throw new Error('No JSON files found to merge.');
    }

    const reports = inputPaths.map((inputPath) => ({
        inputPath,
        data: JSON.parse(fs.readFileSync(inputPath, 'utf8')) as OutputFile,
    }));

    const first = reports[0]!.data;
    const allResults = sortResults(reports.flatMap((report) => report.data.results));
    const topNetPnl = [...allResults].sort((left, right) => right.summary.netPnl - left.summary.netPnl).slice(0, 10);
    const topExpectancy = [...allResults]
        .sort((left, right) => calcExpectancy(right.summary) - calcExpectancy(left.summary) || right.summary.netPnl - left.summary.netPnl)
        .slice(0, 10);
    const topQuality = [...allResults]
        .filter((row) => row.summary.winRate >= 50 && row.summary.maxDd >= -7)
        .sort((left, right) => right.summary.winRate - left.summary.winRate || right.summary.netPnl - left.summary.netPnl)
        .slice(0, 10);
    const notes = Array.from(new Set(reports.flatMap((report) => report.data.notes ?? [])));

    const markdown = [
        '# XAU ABC M5 Optimization Batch',
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
        '## Reference Baselines',
        '',
        '| Lane | Exit | Net PnL | Net R | Exp R/Trade | WR | Max DD | PF | Trades |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        `| \`M5 hard\` | \`HARD_SIGNAL_TP\` | \`${M5_BASELINES.HARD_SIGNAL_TP.netPnl}\` | \`${M5_BASELINES.HARD_SIGNAL_TP.netR}\` | \`${calcExpectancy(M5_BASELINES.HARD_SIGNAL_TP)}\` | \`${M5_BASELINES.HARD_SIGNAL_TP.winRate}%\` | \`${M5_BASELINES.HARD_SIGNAL_TP.maxDd}%\` | \`${M5_BASELINES.HARD_SIGNAL_TP.profitFactor}\` | \`${M5_BASELINES.HARD_SIGNAL_TP.trades}\` |`,
        `| \`M5 swing\` | \`PARTIAL_1R_BE_SWING_TRAIL\` | \`${M5_BASELINES.PARTIAL_1R_BE_SWING_TRAIL.netPnl}\` | \`${M5_BASELINES.PARTIAL_1R_BE_SWING_TRAIL.netR}\` | \`${calcExpectancy(M5_BASELINES.PARTIAL_1R_BE_SWING_TRAIL)}\` | \`${M5_BASELINES.PARTIAL_1R_BE_SWING_TRAIL.winRate}%\` | \`${M5_BASELINES.PARTIAL_1R_BE_SWING_TRAIL.maxDd}%\` | \`${M5_BASELINES.PARTIAL_1R_BE_SWING_TRAIL.profitFactor}\` | \`${M5_BASELINES.PARTIAL_1R_BE_SWING_TRAIL.trades}\` |`,
        '',
        '## Source Files',
        '',
        ...reports.map((report) => `- \`${report.inputPath}\` (${report.data.group}: ${report.data.groupLabel})`),
        '',
        '## Full Variant Table',
        '',
        renderTable(allResults),
        '',
        '## Top 10 By Net PnL',
        '',
        renderTable(topNetPnl),
        '',
        '## Top 10 By Expectancy',
        '',
        renderTable(topExpectancy),
        '',
        '## Top 10 By Quality',
        '',
        topQuality.length > 0 ? renderTable(topQuality) : '_No rows met the `WR >= 50%` and `Max DD >= -7%` quality filter._',
        '',
        '## Variant Change Notes',
        '',
        ...allResults.map((row) => `- \`${row.variantId}\`: ${row.changeSummary}`),
        '',
        '## Batch Notes',
        '',
        ...(notes.length > 0 ? notes.map((note) => `- ${note}`) : ['- No extra batch notes were attached.']),
        '',
        '## Notes For Review',
        '',
        '- This file is machine-generated from split JSON runs so each B-group can be re-run independently.',
        '- Delta PnL is measured against `M5 hard` by default, except `PARTIAL_1R_BE_SWING_TRAIL` rows which use the `M5 swing` lane as their reference.',
        '- Send this markdown file back into Codex for the next review pass.',
    ].join('\n');

    const resolvedOut = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, markdown);
    console.log(`Saved markdown report to ${resolvedOut}`);
}

main();
