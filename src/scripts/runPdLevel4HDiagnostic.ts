import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import {
    BASE_EXECUTION_CONFIG,
    DiagnosticSpec,
    FULL_RANGE_FROM,
    FULL_RANGE_TO,
    LOOSE_GUARDS,
    ensureTier1Signals,
    executeDiagnosticSpec,
    resolvePriorityArtifactDir,
    withGuards,
    writeArtifactPair,
} from './xauPriorityBacktestShared';

const DATE_TAG = new Date().toISOString().slice(0, 10);
const FILE_STEM = `pd-level-4h-diagnostic-${DATE_TAG}`;

const SPECS: DiagnosticSpec[] = [
    {
        slug: 'pd-v2-full-noguard',
        label: 'PD v2 @4H | full range | no guards',
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
        signalVersion: 2,
        timeframe: '4h',
        from: FULL_RANGE_FROM,
        to: FULL_RANGE_TO,
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: '[priority-lane] PD diagnostic | v2 | full range | no guards',
        parameters: { lane: 'pd-diagnostic', variant: 'v2-full-noguard' },
    },
    {
        slug: 'pd-v2-full-loose',
        label: 'PD v2 @4H | full range | loose guards',
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
        signalVersion: 2,
        timeframe: '4h',
        from: FULL_RANGE_FROM,
        to: FULL_RANGE_TO,
        executionConfig: withGuards(LOOSE_GUARDS),
        notes: '[priority-lane] PD diagnostic | v2 | full range | loose guards',
        parameters: { lane: 'pd-diagnostic', variant: 'v2-full-loose' },
    },
    {
        slug: 'pd-h4opt-full-noguard',
        label: 'PD H4-opt v1 | full range | no guards',
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG_H4',
        signalVersion: 1,
        timeframe: '4h',
        from: FULL_RANGE_FROM,
        to: FULL_RANGE_TO,
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: '[priority-lane] PD diagnostic | h4-opt | full range | no guards',
        parameters: { lane: 'pd-diagnostic', variant: 'h4opt-full-noguard' },
    },
    {
        slug: 'pd-h4opt-full-loose',
        label: 'PD H4-opt v1 | full range | loose guards',
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG_H4',
        signalVersion: 1,
        timeframe: '4h',
        from: FULL_RANGE_FROM,
        to: FULL_RANGE_TO,
        executionConfig: withGuards(LOOSE_GUARDS),
        notes: '[priority-lane] PD diagnostic | h4-opt | full range | loose guards',
        parameters: { lane: 'pd-diagnostic', variant: 'h4opt-full-loose' },
    },
    {
        slug: 'pd-v2-2020h1',
        label: 'PD v2 @4H | 2020-H1 crash slice | no guards',
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
        signalVersion: 2,
        timeframe: '4h',
        from: '2020-01-01T00:00:00.000Z',
        to: '2020-06-30T23:59:59.999Z',
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: '[priority-lane] PD diagnostic | 2020-H1 | no guards',
        parameters: { lane: 'pd-diagnostic', variant: 'v2-2020h1' },
    },
    {
        slug: 'pd-v2-2021h2',
        label: 'PD v2 @4H | 2021-H2 range slice | no guards',
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
        signalVersion: 2,
        timeframe: '4h',
        from: '2021-07-01T00:00:00.000Z',
        to: '2021-12-31T23:59:59.999Z',
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: '[priority-lane] PD diagnostic | 2021-H2 | no guards',
        parameters: { lane: 'pd-diagnostic', variant: 'v2-2021h2' },
    },
    {
        slug: 'pd-v2-2024h1',
        label: 'PD v2 @4H | 2024-H1 trend slice | no guards',
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
        signalVersion: 2,
        timeframe: '4h',
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-06-30T23:59:59.999Z',
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: '[priority-lane] PD diagnostic | 2024-H1 | no guards',
        parameters: { lane: 'pd-diagnostic', variant: 'v2-2024h1' },
    },
    {
        slug: 'pd-v2-2025h2',
        label: 'PD v2 @4H | 2025-H2 trend slice | no guards',
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
        signalVersion: 2,
        timeframe: '4h',
        from: '2025-07-01T00:00:00.000Z',
        to: '2025-12-31T23:59:59.999Z',
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: '[priority-lane] PD diagnostic | 2025-H2 | no guards',
        parameters: { lane: 'pd-diagnostic', variant: 'v2-2025h2' },
    },
];

function renderMarkdown(results: Array<{ spec: DiagnosticSpec; metrics: Awaited<ReturnType<typeof executeDiagnosticSpec>> }>, jsonPath: string): string {
    const fullRangeRows = results.filter((row) => row.spec.slug.includes('full-'));
    const regimeRows = results.filter((row) => !row.spec.slug.includes('full-'));

    const lines: string[] = [
        '# PD Level 4H Diagnostic',
        '',
        `- Generated: ${new Date().toISOString()}`,
        `- JSON artifact: \`${jsonPath}\``,
        '',
        '## Full-Range Comparison',
        '',
        '| Variant | Trades | WR | PF | Net PnL | DD | Avg R | Max CL |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...fullRangeRows.map(({ spec, metrics }) => `| ${spec.label} | ${metrics.trades} | ${metrics.winRate}% | ${metrics.profitFactor ?? 'N/A'} | $${metrics.netPnl} | ${metrics.equityDD}% | ${metrics.avgR} | ${metrics.maxConsecutiveLosses} |`),
        '',
        '## Regime Slices',
        '',
        '| Slice | Trades | WR | PF | Net PnL | DD | Avg R | Max CL |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...regimeRows.map(({ spec, metrics }) => `| ${spec.label} | ${metrics.trades} | ${metrics.winRate}% | ${metrics.profitFactor ?? 'N/A'} | $${metrics.netPnl} | ${metrics.equityDD}% | ${metrics.avgR} | ${metrics.maxConsecutiveLosses} |`),
        '',
        '## Diagnostic Focus',
        '',
        '- Compare canonical `v2` versus historical `H4-opt v1` on the same 4H lane.',
        '- Quantify how much `LOOSE` guards change full-range behavior relative to `no guards`.',
        '- Isolate failure and strength slices without reopening a broad optimization sweep.',
    ];

    return lines.join('\n');
}

async function main() {
    const prisma = new PrismaClient();
    const backtests = new SignalBacktestRunService(prisma);
    const execution = new SignalBacktestExecutionService(prisma);

    try {
        await ensureTier1Signals(prisma);

        console.log(`\n${'='.repeat(72)}`);
        console.log('PD Level 4H Diagnostic Lane');
        console.log(`${'='.repeat(72)}\n`);

        const results: Array<{ spec: DiagnosticSpec; metrics: Awaited<ReturnType<typeof executeDiagnosticSpec>> }> = [];

        for (const spec of SPECS) {
            console.log(`Running ${spec.label} ...`);
            const metrics = await executeDiagnosticSpec(prisma, backtests, execution, spec);
            results.push({ spec, metrics });
            console.log(`  trades=${metrics.trades} WR=${metrics.winRate}% PF=${metrics.profitFactor ?? 'N/A'} PnL=$${metrics.netPnl} DD=${metrics.equityDD}% streak=${metrics.maxConsecutiveLosses}`);
        }

        const artifactDir = resolvePriorityArtifactDir();
        const payload = {
            lane: 'pd-level-4h-diagnostic',
            generatedAt: new Date().toISOString(),
            results,
        };
        const jsonPath = `${FILE_STEM}.json`;
        const markdown = renderMarkdown(results, jsonPath);
        const written = writeArtifactPair(artifactDir, FILE_STEM, payload, markdown);

        console.log(`\nSaved JSON: ${written.jsonPath}`);
        console.log(`Saved MD:   ${written.markdownPath}`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error('Fatal:', error);
    process.exit(1);
});
