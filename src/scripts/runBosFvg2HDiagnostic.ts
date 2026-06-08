import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import {
    BASE_EXECUTION_CONFIG,
    DiagnosticSpec,
    FULL_RANGE_FROM,
    FULL_RANGE_TO,
    ensureTier1Signals,
    executeDiagnosticSpec,
    resolvePriorityArtifactDir,
    writeArtifactPair,
} from './xauPriorityBacktestShared';

const DATE_TAG = new Date().toISOString().slice(0, 10);
const FILE_STEM = `bos-fvg-2h-diagnostic-${DATE_TAG}`;

const SPECS: DiagnosticSpec[] = [
    {
        slug: 'bos-base-full',
        label: 'BOS+FVG 2H | full range | base',
        signalCode: 'SYS_4TF_BOS_FVG_LONG',
        signalVersion: 2,
        timeframe: '2h',
        from: FULL_RANGE_FROM,
        to: FULL_RANGE_TO,
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: '[priority-lane] BOS diagnostic | base | full range',
        parameters: { lane: 'bos-diagnostic', variant: 'base-full' },
    },
    {
        slug: 'bos-adx-full',
        label: 'BOS+FVG 2H | full range | ADX regime',
        signalCode: 'SYS_4TF_BOS_FVG_ADX_LONG',
        signalVersion: 1,
        timeframe: '2h',
        from: FULL_RANGE_FROM,
        to: FULL_RANGE_TO,
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: '[priority-lane] BOS diagnostic | adx | full range',
        parameters: { lane: 'bos-diagnostic', variant: 'adx-full' },
    },
    {
        slug: 'bos-base-failure-window',
        label: 'BOS+FVG 2H | 2024-H2 to 2025-H1 | base',
        signalCode: 'SYS_4TF_BOS_FVG_LONG',
        signalVersion: 2,
        timeframe: '2h',
        from: '2024-07-01T00:00:00.000Z',
        to: '2025-06-30T23:59:59.999Z',
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: '[priority-lane] BOS diagnostic | base | failure window',
        parameters: { lane: 'bos-diagnostic', variant: 'base-failure-window' },
    },
    {
        slug: 'bos-adx-failure-window',
        label: 'BOS+FVG 2H | 2024-H2 to 2025-H1 | ADX regime',
        signalCode: 'SYS_4TF_BOS_FVG_ADX_LONG',
        signalVersion: 1,
        timeframe: '2h',
        from: '2024-07-01T00:00:00.000Z',
        to: '2025-06-30T23:59:59.999Z',
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: '[priority-lane] BOS diagnostic | adx | failure window',
        parameters: { lane: 'bos-diagnostic', variant: 'adx-failure-window' },
    },
    {
        slug: 'bos-base-recovery-window',
        label: 'BOS+FVG 2H | 2025-H2 to 2026-Q1 | base',
        signalCode: 'SYS_4TF_BOS_FVG_LONG',
        signalVersion: 2,
        timeframe: '2h',
        from: '2025-07-01T00:00:00.000Z',
        to: '2026-03-14T23:59:59.999Z',
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: '[priority-lane] BOS diagnostic | base | recovery window',
        parameters: { lane: 'bos-diagnostic', variant: 'base-recovery-window' },
    },
    {
        slug: 'bos-adx-recovery-window',
        label: 'BOS+FVG 2H | 2025-H2 to 2026-Q1 | ADX regime',
        signalCode: 'SYS_4TF_BOS_FVG_ADX_LONG',
        signalVersion: 1,
        timeframe: '2h',
        from: '2025-07-01T00:00:00.000Z',
        to: '2026-03-14T23:59:59.999Z',
        executionConfig: BASE_EXECUTION_CONFIG,
        notes: '[priority-lane] BOS diagnostic | adx | recovery window',
        parameters: { lane: 'bos-diagnostic', variant: 'adx-recovery-window' },
    },
];

function renderMarkdown(results: Array<{ spec: DiagnosticSpec; metrics: Awaited<ReturnType<typeof executeDiagnosticSpec>> }>, jsonPath: string): string {
    const fullRows = results.filter((row) => row.spec.slug.endsWith('full'));
    const windowRows = results.filter((row) => !row.spec.slug.endsWith('full'));

    const lines: string[] = [
        '# BOS+FVG 2H Diagnostic',
        '',
        `- Generated: ${new Date().toISOString()}`,
        `- JSON artifact: \`${jsonPath}\``,
        '',
        '## Full-Range Comparison',
        '',
        '| Variant | Trades | WR | PF | Net PnL | DD | Avg R | Max CL |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...fullRows.map(({ spec, metrics }) => `| ${spec.label} | ${metrics.trades} | ${metrics.winRate}% | ${metrics.profitFactor ?? 'N/A'} | $${metrics.netPnl} | ${metrics.equityDD}% | ${metrics.avgR} | ${metrics.maxConsecutiveLosses} |`),
        '',
        '## Failure / Recovery Windows',
        '',
        '| Variant | Trades | WR | PF | Net PnL | DD | Avg R | Max CL |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...windowRows.map(({ spec, metrics }) => `| ${spec.label} | ${metrics.trades} | ${metrics.winRate}% | ${metrics.profitFactor ?? 'N/A'} | $${metrics.netPnl} | ${metrics.equityDD}% | ${metrics.avgR} | ${metrics.maxConsecutiveLosses} |`),
        '',
        '## Diagnostic Focus',
        '',
        '- Compare base `BOS+FVG 2H` against the `ADX regime` branch on the same 2H lane.',
        '- Re-check the known failure cluster (`2024-H2 -> 2025-H1`) without reopening broad guard sweeps.',
        '- Measure whether the recovery window (`2025-H2 -> 2026-Q1`) supports promotion or only regime-conditional use.',
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
        console.log('BOS+FVG 2H Diagnostic Lane');
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
            lane: 'bos-fvg-2h-diagnostic',
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
