/**
 * Go-live paper setup: SYS_4TF_PD_LEVEL_BREAK_LONG v2 (H1 optimized)
 *
 * Creates:
 * 1. IndicatorInstance — live signal runner for XAUUSD H1
 * 2. TradingAutomationBinding — AUTO_EXECUTE on paper account, risk 1.5%
 *
 * Usage: npx ts-node src/scripts/setupGoLivePaper.ts
 */

import { PrismaClient } from '@prisma/client';

const SIGNAL_CODE = 'SYS_4TF_PD_LEVEL_BREAK_LONG';
const SIGNAL_VERSION = 2;
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'H1';
const PAPER_ACCOUNT_ID = 'cmmn7cvdq0007hq7o40qnn1i2'; // CEN P2

async function main() {
    const prisma = new PrismaClient();

    try {
        // ── 1. Verify signal definition exists ──────────────────────────
        const signalDef = await prisma.signalDefinition.findUnique({
            where: { code_version: { code: SIGNAL_CODE, version: SIGNAL_VERSION } },
        });
        if (!signalDef) throw new Error(`Signal ${SIGNAL_CODE} v${SIGNAL_VERSION} not found`);
        console.log(`✓ Signal: ${signalDef.name}`);

        // ── 2. Verify paper account exists ──────────────────────────────
        const account = await prisma.tradingAccount.findUnique({ where: { id: PAPER_ACCOUNT_ID } });
        if (!account) throw new Error(`Paper account ${PAPER_ACCOUNT_ID} not found`);
        if (account.accountMode !== 'PAPER') throw new Error('Account is not PAPER mode');
        console.log(`✓ Account: ${account.label} (${account.accountMode}, status: ${account.status})`);

        // ── 3. Reactivate paper account if in ERROR ─────────────────────
        if (account.status === 'ERROR') {
            await prisma.tradingAccount.update({
                where: { id: PAPER_ACCOUNT_ID },
                data: { status: 'ACTIVE' },
            });
            console.log('✓ Account status: ERROR → ACTIVE');
        }

        // ── 4. Create IndicatorInstance ──────────────────────────────────
        const executionConfig = {
            stopLoss: { mode: 'SIGNAL_PRICE', value: null },
            takeProfit: { mode: 'SIGNAL_PRICE', value: null },
            entryFeeBps: 4,
            exitFeeBps: 4,
            entrySlippageBps: 2,
            exitSlippageBps: 2,
            orderTiming: 'NEXT_BAR_OPEN',
            compoundEquity: false, // paper — flat equity for clean tracking
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
                name: 'Live: 4TF PD Level Break Long H1 (Paper)',
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
        console.log(`✓ IndicatorInstance created: ${instance.id}`);

        // ── 5. Create automation binding ─────────────────────────────────
        const riskConfig = {
            riskPercent: 1.5,       // 1.5% risk per trade — month 1 conservative
            maxOpenPositions: 2,
            dailyMaxTrades: 3,
        };

        const guardrails = {
            maxDailyLossPct: 4.5,   // 3 × 1.5% = hard stop
            maxWeeklyLossPct: 7.5,  // 5 × 1.5%
            killSwitchDrawdownPct: 15,
        };

        const binding = await prisma.tradingAutomationBinding.create({
            data: {
                accountId: PAPER_ACCOUNT_ID,
                indicatorInstanceId: instance.id,
                name: 'Paper Go-Live: XAU H1 PD Break Long',
                status: 'ACTIVE',
                mode: 'AUTO_EXECUTE',
                approvalRequired: false,
                killSwitchActive: false,
                riskConfigJson: riskConfig,
                guardrailsJson: guardrails,
                approvedAt: new Date(),
            },
        });
        console.log(`✓ Binding created: ${binding.id} (AUTO_EXECUTE, risk ${riskConfig.riskPercent}%)`);

        console.log('\n── Go-Live Paper Setup Complete ──');
        console.log(`Signal:     ${SIGNAL_CODE} v${SIGNAL_VERSION}`);
        console.log(`Instance:   ${instance.id}`);
        console.log(`Binding:    ${binding.id}`);
        console.log(`Account:    ${account.label} (PAPER)`);
        console.log(`Risk:       ${riskConfig.riskPercent}% per trade`);
        console.log(`Guards:     dayLossCap 3R/3 trades, DD halt 20%, EQ filter HALF_RISK@30`);
        console.log(`Guardrails: daily max -${guardrails.maxDailyLossPct}%, weekly max -${guardrails.maxWeeklyLossPct}%, kill switch -${guardrails.killSwitchDrawdownPct}%`);
        console.log('\nNext: ensure MT5 bridge is running and paper account reconnects.');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error('Setup failed:', err.message);
    process.exit(1);
});
