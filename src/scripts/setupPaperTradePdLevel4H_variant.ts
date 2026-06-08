/**
 * Archived comparison setup: SYS_4TF_PD_LEVEL_BREAK_LONG_H4 v1 on XAUUSD H4
 *
 * This script is intentionally non-canonical.
 * The default PD Level Break 4H paper/shadow path is:
 * - src/scripts/setupPaperTradePdLevel4H.ts
 *
 * This archived compare path is blocked by default to prevent accidental use.
 * Set ALLOW_PD_LEVEL_VARIANT=1 only when you explicitly need the historical side-by-side comparison.
 *
 * Creates:
 * 1. IndicatorInstance  -- live signal runner for XAUUSD H4
 * 2. TradingAutomationBinding -- AUTO_EXECUTE on CEN P2 paper account, risk 1.5%, non-compound
 *
 * Pre-flight checks:
 * - Verifies the signal definition exists in the database
 * - Finds the CEN P2 PAPER-mode trading account
 * - Checks for duplicate instances to avoid creating duplicates
 *
 * Usage: ALLOW_PD_LEVEL_VARIANT=1 npx ts-node src/scripts/setupPaperTradePdLevel4H_variant.ts
 */

import { PrismaClient } from '@prisma/client';

const SIGNAL_CODE = 'SYS_4TF_PD_LEVEL_BREAK_LONG_H4';
const SIGNAL_VERSION = 1;
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'H4';

async function main() {
    const prisma = new PrismaClient();

    try {
        if (process.env.ALLOW_PD_LEVEL_VARIANT !== '1') {
            throw new Error(
                'Archived non-canonical compare script. Use src/scripts/setupPaperTradePdLevel4H.ts for the canonical paper/shadow baseline. Set ALLOW_PD_LEVEL_VARIANT=1 to intentionally run this historical variant.',
            );
        }

        // ── 1. Verify signal definition exists ──────────────────────────
        const signalDef = await prisma.signalDefinition.findUnique({
            where: { code_version: { code: SIGNAL_CODE, version: SIGNAL_VERSION } },
        });
        if (!signalDef) throw new Error(`Signal ${SIGNAL_CODE} v${SIGNAL_VERSION} not found in the database`);
        console.log(`[ok] Signal: ${signalDef.name} (${SIGNAL_CODE} v${SIGNAL_VERSION})`);

        // ── 2. Find the CEN P2 PAPER trading account ───────────────────
        const paperAccounts = await prisma.tradingAccount.findMany({
            where: { accountMode: 'PAPER' },
            orderBy: { updatedAt: 'desc' },
        });
        if (paperAccounts.length === 0) throw new Error('No PAPER trading accounts found');

        const account = paperAccounts[0];
        console.log(`[ok] Paper account: ${account.label} (id: ${account.id}, status: ${account.status})`);

        if (paperAccounts.length > 1) {
            console.log(`     (${paperAccounts.length} paper accounts found, using most recently updated)`);
        }

        // ── 3. Reactivate paper account if in ERROR ─────────────────────
        if (account.status === 'ERROR') {
            await prisma.tradingAccount.update({
                where: { id: account.id },
                data: { status: 'ACTIVE' },
            });
            console.log('[ok] Account status: ERROR -> ACTIVE');
        }

        // ── 4. Check for existing duplicate instance ────────────────────
        const existing = await prisma.indicatorInstance.findFirst({
            where: {
                signalCode: SIGNAL_CODE,
                signalVersion: SIGNAL_VERSION,
                symbol: SYMBOL,
                timeframe: TIMEFRAME,
                status: { in: ['ACTIVE', 'DRAFT', 'PAUSED'] },
            },
        });
        if (existing) {
            console.log(`[warn] Existing instance found: ${existing.id} (status: ${existing.status})`);
            console.log('       Skipping creation to avoid duplicates.');
            console.log('       To proceed anyway, archive the existing instance first.');
            return;
        }

        // ── 5. Create IndicatorInstance ──────────────────────────────────
        const executionConfig = {
            stopLoss: { mode: 'SIGNAL_PRICE', value: null },
            takeProfit: { mode: 'SIGNAL_PRICE', value: null },
            entryFeeBps: 4,
            exitFeeBps: 4,
            entrySlippageBps: 2,
            exitSlippageBps: 2,
            orderTiming: 'NEXT_BAR_OPEN',
            compoundEquity: false,  // non-compound as requested
            positionSizing: { mode: 'RISK_BASED', value: null },
            tradeGuards: {
                dayLossCap: { maxNetR: 3, maxLosses: 3 },
                sessionLossCap: { maxNetR: null, maxLosses: null },
                maxDrawdownHalt: { maxDrawdownPct: 20 },
                minTradeSpacing: { minSpacingMinutes: null },
                equityCurveFilter: { action: 'HALF_RISK', emaTrades: 30 },
                entryBurstCooldown: { windowMinutes: null, cooldownMinutes: null, maxEntriesInWindow: null },
                lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 480 },
                lossStreakThrottle: { steps: [] },
            },
        };

        const instance = await prisma.indicatorInstance.create({
            data: {
                name: 'Live: 4TF PD Level Break Long H4-opt v1 (Paper)',
                signalCode: SIGNAL_CODE,
                signalVersion: SIGNAL_VERSION,
                symbol: SYMBOL,
                timeframe: TIMEFRAME,
                parameterJson: {
                    goLive: false,
                    paperPhase: true,
                    shadowPhase: true,
                    comparisonOnly: true,
                    notes: '[paper-compare] Archived H4-optimized variant vs canonical baseline',
                },
                executionConfigJson: executionConfig,
                status: 'ACTIVE',
                stateVersion: 1,
            },
        });
        console.log(`[ok] IndicatorInstance created: ${instance.id}`);

        // ── 6. Create automation binding ─────────────────────────────────
        const riskConfig = {
            riskPercent: 1.5,       // 1.5% risk per trade as requested
            maxOpenPositions: 2,
            dailyMaxTrades: 3,
        };

        const guardrails = {
            maxDailyLossPct: 4.5,   // 3 x 1.5% = hard stop
            maxWeeklyLossPct: 7.5,  // 5 x 1.5%
            killSwitchDrawdownPct: 15,
        };

        const binding = await prisma.tradingAutomationBinding.create({
            data: {
                accountId: account.id,
                indicatorInstanceId: instance.id,
                name: 'Paper Compare: XAU H4 PD Level Break Long (H4-opt v1)',
                statusReason: '[paper-compare] Archived non-canonical H4 variant, run only with explicit override',
                status: 'ACTIVE',
                mode: 'AUTO_EXECUTE',
                approvalRequired: false,
                killSwitchActive: false,
                riskConfigJson: riskConfig,
                guardrailsJson: guardrails,
                approvedAt: new Date(),
            },
        });
        console.log(`[ok] Binding created: ${binding.id} (AUTO_EXECUTE, risk ${riskConfig.riskPercent}%)`);

        // ── Summary ──────────────────────────────────────────────────────
        console.log('\n-- Paper Trade Setup Complete (H4-optimized variant) --');
        console.log(`Signal:     ${SIGNAL_CODE} v${SIGNAL_VERSION}`);
        console.log(`Timeframe:  ${TIMEFRAME}`);
        console.log(`Symbol:     ${SYMBOL}`);
        console.log(`Instance:   ${instance.id}`);
        console.log(`Binding:    ${binding.id}`);
        console.log(`Account:    ${account.label} (PAPER, id: ${account.id})`);
        console.log(`Risk:       ${riskConfig.riskPercent}% per trade (non-compound)`);
        console.log(`Guards:     dayLossCap 3R/3 trades, DD halt 20%, EQ filter HALF_RISK@30`);
        console.log(`Guardrails: daily max -${guardrails.maxDailyLossPct}%, weekly max -${guardrails.maxWeeklyLossPct}%, kill switch -${guardrails.killSwitchDrawdownPct}%`);
        console.log(`Notes:      ${binding.statusReason}`);
        console.log('\nThe instance is ACTIVE and will start processing on the next H4 candle close.');
        console.log('Ensure the API server is running and H4 candle ingestion is active.');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error('Setup failed:', err.message);
    process.exit(1);
});
