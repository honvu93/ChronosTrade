/**
 * Paper trade setup: SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG on XAUUSD 2h
 *
 * Creates:
 * 1. IndicatorInstance  -- live signal runner for XAUUSD 2h
 * 2. TradingAutomationBinding -- AUTO_EXECUTE on CEN P2 paper account, risk 1.5%, non-compound
 *
 * Pre-flight checks:
 * - Verifies the signal definition exists in the database
 * - Uses the CEN P2 paper account (same as PD Level 4H setup)
 * - Checks for duplicate instances to avoid creating duplicates
 *
 * Usage: npx ts-node src/scripts/setupPaperTradeAsianBreak2H.ts
 */

import { PrismaClient } from '@prisma/client';

const SIGNAL_CODE = 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG';
const SIGNAL_VERSION = 1;
const SYMBOL = 'XAUUSD';
const TIMEFRAME = '2h';
const PAPER_ACCOUNT_ID = 'cmmn7cvdq0007hq7o40qnn1i2';

async function main() {
    const prisma = new PrismaClient();

    try {
        // ── 1. Verify signal definition exists ──────────────────────────
        const signalDef = await prisma.signalDefinition.findUnique({
            where: { code_version: { code: SIGNAL_CODE, version: SIGNAL_VERSION } },
        });
        if (!signalDef) throw new Error(`Signal ${SIGNAL_CODE} v${SIGNAL_VERSION} not found in the database`);
        console.log(`[ok] Signal: ${signalDef.name} (${SIGNAL_CODE} v${SIGNAL_VERSION})`);

        // ── 2. Find the CEN P2 paper account ───────────────────────────
        const account = await prisma.tradingAccount.findUnique({
            where: { id: PAPER_ACCOUNT_ID },
        });
        if (!account) throw new Error(`Paper account ${PAPER_ACCOUNT_ID} not found`);
        if (account.accountMode !== 'PAPER') throw new Error(`Account ${account.label} is not PAPER mode (got: ${account.accountMode})`);
        console.log(`[ok] Paper account: ${account.label} (id: ${account.id}, status: ${account.status})`);

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
            compoundEquity: false,
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
                name: 'Live: Asian Break Continuation Long 2H (Paper)',
                signalCode: SIGNAL_CODE,
                signalVersion: SIGNAL_VERSION,
                symbol: SYMBOL,
                timeframe: TIMEFRAME,
                parameterJson: { goLive: true, paperPhase: true },
                executionConfigJson: executionConfig,
                status: 'ACTIVE',
                stateVersion: 1,
            },
        });
        console.log(`[ok] IndicatorInstance created: ${instance.id}`);

        // ── 6. Create automation binding ─────────────────────────────────
        const riskConfig = {
            riskPercent: 1.5,
            maxOpenPositions: 2,
            dailyMaxTrades: 3,
        };

        const guardrails = {
            maxDailyLossPct: 4.5,
            maxWeeklyLossPct: 7.5,
            killSwitchDrawdownPct: 15,
        };

        const binding = await prisma.tradingAutomationBinding.create({
            data: {
                accountId: account.id,
                indicatorInstanceId: instance.id,
                name: 'Paper: XAU 2H Asian Break Continuation Long',
                statusReason: '[paper-trade] Asian Break Continuation 2H - Tier 2 go-live candidate',
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
        console.log('\n-- Paper Trade Setup Complete --');
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
        console.log('\nThe instance is ACTIVE and will start processing on the next 2H candle close.');
        console.log('Ensure the API server is running and 2H candle ingestion is active.');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error('Setup failed:', err.message);
    process.exit(1);
});
