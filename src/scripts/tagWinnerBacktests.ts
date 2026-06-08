/**
 * Tag winner backtest runs in the database with [★ GO-LIVE] prefix.
 *
 * Targets:
 *   1. Full-range (2019→2026) runs for go-live strategies:
 *      - SYS_4TF_PD_LEVEL_BREAK_LONG v2 on 4h (portfolio-corr, ~291 trades)
 *      - SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG v1 on 2h (portfolio-corr, ~382 trades)
 *      - SYS_4TF_PD_LEVEL_BREAK_LONG_H4 v1 on 4h (any full-range run)
 *   2. Walk-forward fold runs for the same strategies
 *
 * Only updates the `notes` field (prepends tag if not already present).
 *
 * Usage:
 *   npx ts-node src/scripts/tagWinnerBacktests.ts
 *   npx ts-node src/scripts/tagWinnerBacktests.ts --dry-run
 */
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const TAG = '[★ GO-LIVE]';
const DRY_RUN = process.argv.includes('--dry-run');

interface TagCandidate {
    id: string;
    signalCode: string | null;
    signalVersion: number | null;
    timeframe: string;
    notes: string | null;
    tradeCount: number;
    reason: string;
}

// ─── Strategy Targets ────────────────────────────────────────────────────────

interface StrategyTarget {
    signalCode: string;
    signalVersion: number;
    timeframe: string;
    label: string;
}

const FULL_RANGE_TARGETS: StrategyTarget[] = [
    {
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
        signalVersion: 2,
        timeframe: '4h',
        label: 'PD Level Break 4H v2',
    },
    {
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        signalVersion: 1,
        timeframe: '2h',
        label: 'Asian Break 2H v1',
    },
    {
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG_H4',
        signalVersion: 1,
        timeframe: '4h',
        label: 'PD Level Break H4 Optimized v1',
    },
];

const WF_TARGETS: StrategyTarget[] = [
    {
        signalCode: 'SYS_4TF_PD_LEVEL_BREAK_LONG',
        signalVersion: 1,
        timeframe: '4h',
        label: 'PD Level Break 4H',
    },
    {
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        signalVersion: 1,
        timeframe: '2h',
        label: 'Asian Break 2H',
    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function alreadyTagged(notes: string | null): boolean {
    return !!notes && notes.includes(TAG);
}

function prependTag(notes: string | null): string {
    if (!notes) return TAG;
    return `${TAG} ${notes}`;
}

// ─── Find Best Full-Range Runs ───────────────────────────────────────────────

async function findBestFullRangeRuns(
    prisma: PrismaClient,
    target: StrategyTarget,
): Promise<TagCandidate[]> {
    // Find all COMPLETED runs for this strategy/timeframe that span 2019→2026
    // (non walk-forward: notes should NOT contain "[walk-forward]")
    const runs = await prisma.backtestRun.findMany({
        where: {
            signalCode: target.signalCode,
            signalVersion: target.signalVersion,
            timeframe: target.timeframe,
            status: 'COMPLETED',
            symbol: { contains: 'XAU' },
        },
        select: {
            id: true,
            signalCode: true,
            signalVersion: true,
            timeframe: true,
            notes: true,
            name: true,
            createdAt: true,
            _count: { select: { results: true } },
        },
        orderBy: { createdAt: 'desc' },
    });

    // Filter to full-range runs (not walk-forward folds, not short date ranges)
    const fullRangeRuns = runs.filter((r) => {
        // Exclude walk-forward folds
        if (r.notes?.includes('[walk-forward]')) return false;
        // Must have the name span 2019..2026 (the name format includes date range)
        if (r.name.includes('2019') && r.name.includes('2026')) return true;
        // Or check notes for portfolio-corr / go-live-candidate markers
        if (r.notes?.includes('[portfolio-corr]')) return true;
        if (r.notes?.includes('[go-live-candidate]')) return true;
        // Accept any run with a substantial number of trades (likely full range)
        if (r._count.results >= 100) return true;
        return false;
    });

    if (fullRangeRuns.length === 0) {
        console.log(`  ⚠ No full-range runs found for ${target.label}`);
        return [];
    }

    // Sort by trade count descending, pick the best one (most trades)
    fullRangeRuns.sort((a, b) => b._count.results - a._count.results);
    const best = fullRangeRuns[0];

    console.log(
        `  ✓ Best full-range run for ${target.label}: ${best.id} (${best._count.results} trades)`,
    );
    console.log(`    Notes: ${best.notes || '(none)'}`);

    return [
        {
            id: best.id,
            signalCode: best.signalCode,
            signalVersion: best.signalVersion,
            timeframe: best.timeframe,
            notes: best.notes,
            tradeCount: best._count.results,
            reason: `Best full-range: ${target.label}`,
        },
    ];
}

// ─── Find Walk-Forward Fold Runs ─────────────────────────────────────────────

async function findWalkForwardRuns(
    prisma: PrismaClient,
    target: StrategyTarget,
): Promise<TagCandidate[]> {
    const runs = await prisma.backtestRun.findMany({
        where: {
            signalCode: target.signalCode,
            signalVersion: target.signalVersion,
            timeframe: target.timeframe,
            status: 'COMPLETED',
            symbol: { contains: 'XAU' },
            notes: { contains: '[walk-forward]' },
        },
        select: {
            id: true,
            signalCode: true,
            signalVersion: true,
            timeframe: true,
            notes: true,
            name: true,
            createdAt: true,
            _count: { select: { results: true } },
        },
        orderBy: { createdAt: 'desc' },
    });

    if (runs.length === 0) {
        console.log(`  ⚠ No walk-forward runs found for ${target.label}`);
        return [];
    }

    // Group by fold identifier (extract from notes: train-fold-N / test-fold-N)
    const foldGroups = new Map<string, typeof runs>();
    for (const r of runs) {
        const match = r.notes?.match(/((?:train|test)-fold-\d+)/);
        const foldKey = match ? match[1] : r.id;
        if (!foldGroups.has(foldKey)) foldGroups.set(foldKey, []);
        foldGroups.get(foldKey)!.push(r);
    }

    const candidates: TagCandidate[] = [];

    // For each fold, pick the run with the most trades
    for (const [foldKey, foldRuns] of foldGroups) {
        foldRuns.sort((a, b) => b._count.results - a._count.results);
        const best = foldRuns[0];
        candidates.push({
            id: best.id,
            signalCode: best.signalCode,
            signalVersion: best.signalVersion,
            timeframe: best.timeframe,
            notes: best.notes,
            tradeCount: best._count.results,
            reason: `WF ${foldKey}: ${target.label}`,
        });
    }

    console.log(
        `  ✓ Found ${candidates.length} walk-forward fold runs for ${target.label}`,
    );

    return candidates;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const prisma = new PrismaClient();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Tag Winner Backtests — ${TAG}`);
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will update DB)'}`);
    console.log(`${'='.repeat(70)}\n`);

    const allCandidates: TagCandidate[] = [];

    // 1. Full-range runs
    console.log('── Finding best full-range runs ──');
    for (const target of FULL_RANGE_TARGETS) {
        const candidates = await findBestFullRangeRuns(prisma, target);
        allCandidates.push(...candidates);
    }

    // 2. Walk-forward runs
    console.log('\n── Finding walk-forward fold runs ──');
    for (const target of WF_TARGETS) {
        const candidates = await findWalkForwardRuns(prisma, target);
        allCandidates.push(...candidates);
    }

    // 3. Apply tags
    console.log(`\n── Tagging ${allCandidates.length} runs ──`);

    let tagged = 0;
    let skipped = 0;

    for (const candidate of allCandidates) {
        if (alreadyTagged(candidate.notes)) {
            console.log(`  SKIP (already tagged): ${candidate.id} — ${candidate.reason}`);
            skipped++;
            continue;
        }

        const newNotes = prependTag(candidate.notes);

        if (DRY_RUN) {
            console.log(`  DRY-RUN would tag: ${candidate.id}`);
            console.log(`    Reason: ${candidate.reason}`);
            console.log(`    Trades: ${candidate.tradeCount}`);
            console.log(`    Old notes: ${candidate.notes || '(none)'}`);
            console.log(`    New notes: ${newNotes}`);
        } else {
            await prisma.backtestRun.update({
                where: { id: candidate.id },
                data: { notes: newNotes },
            });
            console.log(
                `  TAGGED: ${candidate.id} — ${candidate.reason} (${candidate.tradeCount} trades)`,
            );
        }
        tagged++;
    }

    // 4. Summary
    console.log(`\n${'='.repeat(70)}`);
    console.log('Summary');
    console.log(`${'='.repeat(70)}`);
    console.log(`  Total candidates found: ${allCandidates.length}`);
    console.log(`  Tagged:                 ${tagged}`);
    console.log(`  Skipped (already):      ${skipped}`);
    if (DRY_RUN) {
        console.log(`\n  ⚠ DRY RUN — no changes were made. Run without --dry-run to apply.`);
    }
    console.log(`${'='.repeat(70)}\n`);

    await prisma.$disconnect();
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
