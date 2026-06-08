import path from 'path';
import { spawnSync } from 'child_process';
import { DEFAULT_OUT_DIR } from './xauAbcOptimizationShared';

type Step = {
    label: string;
    script: string;
    args?: string[];
};

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const STEPS: Step[] = [
    {
        label: 'B1 - ATR sweep',
        script: 'src/scripts/runXauAbcB1AtrSweep.ts',
    },
    {
        label: 'B2 - RSI sweep',
        script: 'src/scripts/runXauAbcB2RsiSweep.ts',
    },
    {
        label: 'B3 - Session slices',
        script: 'src/scripts/runXauAbcB3SessionSlices.ts',
    },
    {
        label: 'B4 - Stop geometry',
        script: 'src/scripts/runXauAbcB4StopGeometry.ts',
    },
    {
        label: 'B5 - Regime gate proxies',
        script: 'src/scripts/runXauAbcB5RegimeGate.ts',
    },
    {
        label: 'B6 - Exit sweep',
        script: 'src/scripts/runXauAbcB6ExitSweep.ts',
    },
    {
        label: 'Merged markdown report',
        script: 'src/scripts/renderXauAbcM5OptimizationReport.ts',
        args: [
            '--dir',
            DEFAULT_OUT_DIR,
            '--out',
            `${DEFAULT_OUT_DIR}/xau-abc-m5-optimization.md`,
        ],
    },
];

function runStep(step: Step) {
    const scriptPath = path.resolve(PROJECT_ROOT, step.script);
    const child = spawnSync(
        process.execPath,
        ['-r', 'ts-node/register', scriptPath, ...(step.args ?? [])],
        {
            cwd: PROJECT_ROOT,
            env: process.env,
            stdio: 'inherit',
        },
    );

    if (child.status !== 0) {
        throw new Error(`Step failed: ${step.label}`);
    }
}

function main() {
    console.log('Running full XAU ABC M5 optimization sequence...');
    for (const step of STEPS) {
        console.log(`\n=== ${step.label} ===`);
        runStep(step);
    }
    console.log('\nAll XAU ABC M5 batches and the merged report completed successfully.');
}

main();
