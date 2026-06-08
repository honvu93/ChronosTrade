/**
 * Re-run backtests affected by the trail-stage signal-TP bug.
 *
 * Usage (5 terminals, one per shard):
 *   npx ts-node src/scripts/rerunAffectedBacktests.ts --shard 0 --shards 5
 *   npx ts-node src/scripts/rerunAffectedBacktests.ts --shard 1 --shards 5
 *   npx ts-node src/scripts/rerunAffectedBacktests.ts --shard 2 --shards 5
 *   npx ts-node src/scripts/rerunAffectedBacktests.ts --shard 3 --shards 5
 *   npx ts-node src/scripts/rerunAffectedBacktests.ts --shard 4 --shards 5
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';

const AFFECTED_RUN_IDS = [
    'cmn5fh8aa0n25tkhm26e40lbk',
    'cmn5fh8f20ngytkhmfv6p6s2e',
    'cmn70xwer0000tk4l4rcl14tc',
    'cmn76vshz0000tkq4xfedz0gg',
    'cmn76vtdk02sxtkq47aenafnz',
    'cmn78anou0000tknik52ufngj',
    'cmn78aoo102svtknioxlz5u7u',
    'cmn78apfj05lqtknio7ba79wr',
    'cmn78aq7908entkni3ae1yhjl',
    'cmn78ye4f0000tk4xediwx6r5',
    'cmn78yf3802svtk4xeh4m05qy',
    'cmn78yfzt05lstk4x10yd4yzl',
    'cmn78z1330000tk92uff1ofil',
    'cmn78z20t02svtk92bozt80mk',
    'cmn78z2tf05lutk92muar94mi',
];

function parseArgs() {
    const args = process.argv.slice(2);
    let shard = 0;
    let shards = 1;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--shard') shard = Number(args[++i]);
        if (args[i] === '--shards') shards = Number(args[++i]);
    }
    return { shard, shards };
}

async function main() {
    const { shard, shards } = parseArgs();
    const myRunIds = AFFECTED_RUN_IDS.filter((_, i) => i % shards === shard);

    console.log(`[shard ${shard}/${shards}] Will re-run ${myRunIds.length} backtests: ${myRunIds.join(', ')}`);

    const prisma = new PrismaClient();
    const execution = new SignalBacktestExecutionService(prisma);

    let done = 0;
    let failed = 0;

    for (const runId of myRunIds) {
        const label = `[shard ${shard}] [${done + 1}/${myRunIds.length}] ${runId}`;
        try {
            console.log(`${label} — starting...`);
            const t0 = Date.now();
            const result = await execution.executeRun(runId);
            const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
            console.log(
                `${label} — DONE in ${elapsed}s ` +
                `(signals=${result.counts.persistedSignals}, results=${result.counts.persistedResults})`,
            );
            done++;
        } catch (err: any) {
            failed++;
            console.error(`${label} — FAILED: ${err.message}`);
        }
    }

    console.log(`\n[shard ${shard}] Finished. OK=${done} FAILED=${failed}`);
    await prisma.$disconnect();
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
