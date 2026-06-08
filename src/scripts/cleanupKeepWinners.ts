import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

/**
 * Cleanup: Delete all backtest runs EXCEPT [★ GO-LIVE] tagged winners.
 *
 * Usage:
 *   npx ts-node src/scripts/cleanupKeepWinners.ts              # dry-run
 *   npx ts-node src/scripts/cleanupKeepWinners.ts --apply       # execute
 */

const DRY_RUN = !process.argv.includes('--apply');
const CHUNK = 500;

async function main() {
    const prisma = new PrismaClient();

    try {
        const allRuns = await prisma.backtestRun.findMany({
            select: { id: true, notes: true, signalCode: true, timeframe: true, _count: { select: { results: true, signals: true } } },
            orderBy: { createdAt: 'desc' },
        });

        const keep: typeof allRuns = [];
        const remove: typeof allRuns = [];

        for (const run of allRuns) {
            if (run.notes?.includes('[★ GO-LIVE]')) {
                keep.push(run);
            } else {
                remove.push(run);
            }
        }

        console.log(`\nTotal runs:   ${allRuns.length}`);
        console.log(`Keep (★):     ${keep.length}`);
        console.log(`Delete:       ${remove.length}`);
        console.log(`Mode:         ${DRY_RUN ? 'DRY-RUN (add --apply to execute)' : 'APPLY'}\n`);

        if (keep.length > 0) {
            console.log('=== KEEPING ===');
            for (const r of keep) {
                console.log(`  [★] ${r.signalCode} ${r.timeframe} | ${r._count.results} trades | ${(r.notes ?? '').substring(0, 60)}`);
            }
            console.log();
        }

        if (remove.length === 0) {
            console.log('Nothing to delete.');
            return;
        }

        const removeIds = remove.map((r) => r.id);
        const totalTrades = remove.reduce((s, r) => s + r._count.results, 0);
        const totalSignals = remove.reduce((s, r) => s + r._count.signals, 0);
        console.log(`=== DELETING ${remove.length} runs (${totalTrades} trades, ${totalSignals} signals) ===\n`);

        if (DRY_RUN) {
            for (const r of remove.slice(0, 10)) {
                console.log(`  [x] ${(r.signalCode ?? '?').padEnd(45)} ${r.timeframe?.padEnd(4)} | ${r._count.results} trades | ${(r.notes ?? '').substring(0, 50)}`);
            }
            if (remove.length > 10) console.log(`  ... and ${remove.length - 10} more`);
            console.log(`\nRun with --apply to delete.`);
            return;
        }

        // Delete children in chunks to avoid OOM
        for (let i = 0; i < removeIds.length; i += CHUNK) {
            const chunk = removeIds.slice(i, i + CHUNK);
            const label = `[${i + 1}-${Math.min(i + CHUNK, removeIds.length)}/${removeIds.length}]`;

            const dr = await prisma.backtestTradeResult.deleteMany({ where: { backtestRunId: { in: chunk } } });
            const ds = await prisma.signal.deleteMany({ where: { backtestRunId: { in: chunk } } });
            const de = await prisma.signalEvent.deleteMany({ where: { backtestRunId: { in: chunk } } });
            const dl = await prisma.signalLogicTrace.deleteMany({ where: { backtestRunId: { in: chunk } } });
            const dRuns = await prisma.backtestRun.deleteMany({ where: { id: { in: chunk } } });

            console.log(`  ${label} deleted ${dRuns.count} runs, ${dr.count} trades, ${ds.count} signals, ${de.count} events, ${dl.count} traces`);
        }

        const remaining = await prisma.backtestRun.count();
        console.log(`\nDone. ${remaining} runs remaining in DB.`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
