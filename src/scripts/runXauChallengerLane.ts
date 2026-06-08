import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { resolvePriorityArtifactDir } from './xauPriorityBacktestShared';

interface ChildRunResult {
    name: string;
    script: string;
    logPath: string;
    exitCode: number | null;
    signal: string | null;
}

function runTsNodeScript(name: string, scriptRelativePath: string, artifactDir: string): Promise<ChildRunResult> {
    return new Promise((resolve, reject) => {
        const logPath = path.join(artifactDir, `${name}.log`);
        const logStream = fs.createWriteStream(logPath, { flags: 'w' });
        const scriptPath = path.resolve(scriptRelativePath);
        const tsNodeRegister = require.resolve('ts-node/register');
        const child = spawn(process.execPath, ['-r', tsNodeRegister, scriptPath], {
            cwd: process.cwd(),
            env: { ...process.env, XAU_PRIORITY_ARTIFACT_DIR: artifactDir },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout.on('data', (chunk) => {
            process.stdout.write(`[${name}] ${chunk}`);
            logStream.write(chunk);
        });
        child.stderr.on('data', (chunk) => {
            process.stderr.write(`[${name}] ${chunk}`);
            logStream.write(chunk);
        });

        child.on('error', (error) => {
            logStream.end();
            reject(error);
        });

        child.on('close', (code, signal) => {
            logStream.end();
            resolve({
                name,
                script: scriptRelativePath,
                logPath,
                exitCode: code,
                signal,
            });
        });
    });
}

async function main() {
    const artifactDir = resolvePriorityArtifactDir();
    const laneDir = path.join(artifactDir, 'challengers');
    fs.mkdirSync(laneDir, { recursive: true });

    console.log(`\n${'='.repeat(72)}`);
    console.log('XAU Challenger Lane');
    console.log(`${'='.repeat(72)}`);
    console.log(`Artifact dir: ${laneDir}\n`);

    const jobs = await Promise.all([
        runTsNodeScript('s3-optimized', 'src/scripts/runNewStrategy3Optimized.ts', laneDir),
        runTsNodeScript('s5-optimized', 'src/scripts/runNewStrategy5Optimized.ts', laneDir),
    ]);

    const summary = {
        lane: 'xau-challengers',
        generatedAt: new Date().toISOString(),
        jobs,
    };

    const summaryPath = path.join(laneDir, 'summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`\nSaved summary: ${summaryPath}`);

    const failed = jobs.filter((job) => job.exitCode !== 0);
    if (failed.length > 0) {
        console.error(`Challenger lane failed: ${failed.map((job) => job.name).join(', ')}`);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('Fatal:', error);
    process.exit(1);
});
