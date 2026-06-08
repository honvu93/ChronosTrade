/**
 * Cleanup backtest runs — keep top 50, delete the rest.
 *
 * Walk-forward fold results are preserved in .artifacts/walk-forward/*.json
 * so the 1,092 WF fold runs can be safely deleted from DB.
 *
 * Usage:
 *   npx ts-node src/scripts/cleanupBacktestRuns.ts          # dry-run (preview)
 *   npx ts-node src/scripts/cleanupBacktestRuns.ts --apply  # actually delete
 */
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

async function main() {
    const dryRun = !process.argv.includes('--apply');
    const prisma = new PrismaClient();

    try {
        const allRuns = await prisma.backtestRun.findMany({
            select: {
                id: true, signalCode: true, signalVersion: true, timeframe: true,
                startedAt: true, finishedAt: true, notes: true, createdAt: true,
                _count: { select: { results: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        console.log(`Total runs: ${allRuns.length}`);

        // ─── Selection logic ─────────────────────────────────────────────
        const keepIds = new Set<string>();

        // Priority 1: go-live candidates (3 runs)
        for (const r of allRuns) {
            if (r.notes?.includes('[go-live-candidate]')) keepIds.add(r.id);
        }

        // Priority 2: portfolio correlation (2 runs)
        for (const r of allRuns) {
            if (r.notes?.includes('[portfolio-corr]')) keepIds.add(r.id);
        }

        // Priority 3: phase3 OOS validation (8 runs)
        for (const r of allRuns) {
            if (r.notes?.includes('[phase3]')) keepIds.add(r.id);
        }

        // Priority 4: compound sweep — keep risk=3% only (best risk-adjusted, 7 runs)
        for (const r of allRuns) {
            if (r.notes?.includes('[compound-sweep]') && r.notes?.includes('risk=3%')) {
                keepIds.add(r.id);
            }
        }

        // Priority 5: compound-guarded — keep R3-LIGHT per strategy (4 runs)
        for (const r of allRuns) {
            if (r.notes?.includes('[compound-guarded]') && r.notes?.includes('R3-LIGHT')) {
                keepIds.add(r.id);
            }
        }

        // Priority 6: guard-opt — keep LOOSE for each unique signal+timeframe (best balance)
        const guardOptSeen = new Set<string>();
        for (const r of allRuns) {
            if (r.notes?.includes('[guard-opt]') && r.notes?.includes('LOOSE')) {
                const key = `${r.signalCode}@${r.timeframe}`;
                if (!guardOptSeen.has(key)) {
                    guardOptSeen.add(key);
                    keepIds.add(r.id);
                }
            }
        }

        // Priority 7: batch runs — keep 1 best (most trades) per signal+timeframe
        const batchBest = new Map<string, typeof allRuns[0]>();
        for (const r of allRuns) {
            if (r.notes?.includes('[batch:')) {
                const key = `${r.signalCode}@${r.timeframe}`;
                const existing = batchBest.get(key);
                if (!existing || r._count.results > existing._count.results) {
                    batchBest.set(key, r);
                }
            }
        }
        for (const r of batchBest.values()) keepIds.add(r.id);

        // Priority 8: 1h-guard-sweep — keep TIGHT for each strategy (best WF result)
        const guardSweepSeen = new Set<string>();
        for (const r of allRuns) {
            if (r.notes?.includes('[1h-guard-sweep]') && r.notes?.includes('TIGHT')) {
                const key = `${r.signalCode}`;
                if (!guardSweepSeen.has(key)) {
                    guardSweepSeen.add(key);
                    keepIds.add(r.id);
                }
            }
        }

        // Priority 9: fill remaining slots from "other" (untagged) — most trades first
        const others = allRuns
            .filter(r => !keepIds.has(r.id) && !r.notes?.includes('[walk-forward]'))
            .sort((a, b) => b._count.results - a._count.results);

        const remaining = 50 - keepIds.size;
        for (let i = 0; i < Math.max(0, remaining) && i < others.length; i++) {
            keepIds.add(others[i].id);
        }

        // ─── Report ──────────────────────────────────────────────────────
        const toDelete = allRuns.filter(r => !keepIds.has(r.id));
        const toKeep = allRuns.filter(r => keepIds.has(r.id));

        console.log(`\nKeeping: ${toKeep.length} runs`);
        console.log(`Deleting: ${toDelete.length} runs`);
        console.log(`\n── KEEPING ──`);
        for (const r of toKeep.sort((a, b) => (b._count.results - a._count.results))) {
            const from = r.startedAt?.toISOString().slice(0, 10) || '?';
            const to = r.finishedAt?.toISOString().slice(0, 10) || '?';
            console.log(
                `  ${String(r._count.results).padStart(5)} trades  ${(r.signalCode || '').slice(0, 38).padEnd(40)} ${(r.timeframe || '').padEnd(4)} ${from}→${to}  ${(r.notes || '').slice(0, 55)}`,
            );
        }

        // Breakdown of what's being deleted
        const delCats: Record<string, number> = {};
        for (const r of toDelete) {
            const n = r.notes || '';
            let cat = 'untagged';
            if (n.includes('[walk-forward]')) cat = 'walk-forward folds';
            else if (n.includes('[compound-sweep]')) cat = 'compound-sweep (non-3%)';
            else if (n.includes('[compound-guarded]')) cat = 'compound-guarded (non-R3-LIGHT)';
            else if (n.includes('[guard-opt]')) cat = 'guard-opt (non-LOOSE)';
            else if (n.includes('[batch:')) cat = 'batch (duplicate)';
            else if (n.includes('[1h-guard-sweep]')) cat = '1h-guard-sweep (non-TIGHT)';
            delCats[cat] = (delCats[cat] || 0) + 1;
        }
        console.log(`\n── DELETING (by category) ──`);
        for (const [cat, count] of Object.entries(delCats).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${String(count).padStart(5)}  ${cat}`);
        }

        if (dryRun) {
            console.log(`\n⚠️  DRY RUN — no changes made. Run with --apply to delete.`);
            return;
        }

        // ─── Delete ──────────────────────────────────────────────────────
        console.log(`\nDeleting ${toDelete.length} runs and their related records...`);
        const deleteIds = toDelete.map(r => r.id);

        // Delete children first (signals, events, traces, results), then runs
        // Schema has onDelete: Cascade but deleteMany doesn't trigger cascades
        const childTables = [
            { name: 'trade results', model: prisma.backtestTradeResult },
            { name: 'signals', model: prisma.signal },
            { name: 'events', model: prisma.signalEvent },
            { name: 'logic traces', model: prisma.signalLogicTrace },
        ] as const;

        for (const { name, model } of childTables) {
            // Delete in chunks to avoid query size limits
            for (let i = 0; i < deleteIds.length; i += 100) {
                const chunk = deleteIds.slice(i, i + 100);
                const del = await (model as any).deleteMany({ where: { backtestRunId: { in: chunk } } });
                if (del.count > 0) console.log(`  Deleted ${del.count} ${name} (chunk ${Math.floor(i / 100) + 1})`);
            }
        }

        // Delete the runs themselves
        for (let i = 0; i < deleteIds.length; i += 100) {
            const chunk = deleteIds.slice(i, i + 100);
            const del = await prisma.backtestRun.deleteMany({ where: { id: { in: chunk } } });
            console.log(`  Deleted ${del.count} backtest runs (chunk ${Math.floor(i / 100) + 1})`);
        }

        console.log(`\n✅ Done. ${keepIds.size} runs remaining.`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
