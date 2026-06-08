import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

interface LaneResult {
    lane: string;
    script: string;
    logPath: string;
    exitCode: number | null;
    signal: string | null;
}

interface LaneSpec {
    lane: string;
    script: string;
}

function parseArgs() {
    const args = process.argv.slice(2);
    const has = (flag: string) => args.includes(flag);
    const get = (flag: string) => {
        const index = args.indexOf(flag);
        return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
    };

    const only = get('--only');
    const selected = only
        ? new Set(only.split(',').map((item) => item.trim()).filter(Boolean))
        : null;

    return {
        dryRun: has('--dry-run'),
        selected,
    };
}

function spawnLane(spec: LaneSpec, artifactDir: string): Promise<LaneResult> {
    return new Promise((resolve, reject) => {
        const tsNodeRegister = require.resolve('ts-node/register');
        const scriptPath = path.resolve(spec.script);
        const logPath = path.join(artifactDir, `${spec.lane}.log`);
        const logStream = fs.createWriteStream(logPath, { flags: 'w' });
        const child = spawn(process.execPath, ['-r', tsNodeRegister, scriptPath], {
            cwd: process.cwd(),
            env: { ...process.env, XAU_PRIORITY_ARTIFACT_DIR: artifactDir },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout.on('data', (chunk) => {
            process.stdout.write(`[${spec.lane}] ${chunk}`);
            logStream.write(chunk);
        });
        child.stderr.on('data', (chunk) => {
            process.stderr.write(`[${spec.lane}] ${chunk}`);
            logStream.write(chunk);
        });

        child.on('error', (error) => {
            logStream.end();
            reject(error);
        });

        child.on('close', (code, signal) => {
            logStream.end();
            resolve({
                lane: spec.lane,
                script: spec.script,
                logPath,
                exitCode: code,
                signal,
            });
        });
    });
}

async function main() {
    const { dryRun, selected } = parseArgs();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const artifactDir = path.resolve('.artifacts', 'priority-backtests', `parallel-${timestamp}`);
    fs.mkdirSync(artifactDir, { recursive: true });

    const allLanes: LaneSpec[] = [
        { lane: 'pd-diagnostic', script: 'src/scripts/runPdLevel4HDiagnostic.ts' },
        { lane: 'bos-diagnostic', script: 'src/scripts/runBosFvg2HDiagnostic.ts' },
        { lane: 'challengers', script: 'src/scripts/runXauChallengerLane.ts' },
    ];

    const lanes = selected
        ? allLanes.filter((lane) => selected.has(lane.lane))
        : allLanes;

    if (lanes.length === 0) {
        console.error('No lanes selected. Available: pd-diagnostic, bos-diagnostic, challengers');
        process.exit(1);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('XAU Parallel Priority Backtests');
    console.log(`${'='.repeat(80)}`);
    console.log(`Artifact dir: ${artifactDir}`);
    console.log(`Lanes: ${lanes.map((lane) => lane.lane).join(', ')}`);

    if (dryRun) {
        console.log('\nDry run only. Planned commands:');
        for (const lane of lanes) {
            console.log(`- ${lane.lane}: node -r ts-node/register ${lane.script}`);
        }
        return;
    }

    console.log();
    const results = await Promise.all(lanes.map((lane) => spawnLane(lane, artifactDir)));

    const summary = {
        generatedAt: new Date().toISOString(),
        artifactDir,
        lanes: results,
    };
    const summaryPath = path.join(artifactDir, 'summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    const failed = results.filter((result) => result.exitCode !== 0);
    console.log(`\nSaved summary: ${summaryPath}`);
    if (failed.length > 0) {
        console.error(`Failed lanes: ${failed.map((result) => result.lane).join(', ')}`);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('Fatal:', error);
    process.exit(1);
});
