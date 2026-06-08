/**
 * Canonical paper/shadow setup: SYS_4TF_PD_LEVEL_BREAK_LONG on XAUUSD H4
 *
 * Decision baseline:
 * - 1.5% risk
 * - non-compound
 * - engine guards disabled
 * - paper/shadow only, not full go-live
 *
 * Creates:
 * 1. IndicatorInstance -- live signal runner for XAUUSD H4
 * 2. TradingAutomationBinding -- AUTO_EXECUTE on the canonical paper account
 *
 * Pre-flight checks:
 * - Verifies the signal definition exists in the database
 * - Uses the canonical PAPER-mode trading account
 * - Checks for duplicate instances to avoid creating duplicates
 *
 * Source of truth:
 * - _bmad-output/planning-artifacts/xau-pd-level-break-4h-canonical-decision-2026-03-26.md
 *
 * Usage: npx ts-node src/scripts/setupPaperTradePdLevel4H.ts
 */

import { PrismaClient } from '@prisma/client';

const SIGNAL_CODE = 'SYS_4TF_PD_LEVEL_BREAK_LONG';
const SIGNAL_VERSION = 2;
const SYMBOL = 'XAUUSD';
const TIMEFRAME = 'H4';
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

        // ── 2. Use the canonical PAPER trading account ──────────────────
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
                dayLossCap: { maxNetR: null, maxLosses: null },
                sessionLossCap: { maxNetR: null, maxLosses: null },
                maxDrawdownHalt: { maxDrawdownPct: null },
                minTradeSpacing: { minSpacingMinutes: null },
                equityCurveFilter: { action: null, emaTrades: null },
                entryBurstCooldown: { windowMinutes: null, cooldownMinutes: null, maxEntriesInWindow: null },
                lossStreakCooldown: { afterLosses: null, cooldownMinutes: null },
                lossStreakThrottle: { steps: [] },
            },
        };

        const instance = await prisma.indicatorInstance.create({
            data: {
                name: 'Paper Shadow: 4TF PD Level Break Long H4 (Canonical)',
                signalCode: SIGNAL_CODE,
                signalVersion: SIGNAL_VERSION,
                symbol: SYMBOL,
                timeframe: TIMEFRAME,
                parameterJson: {
                    goLive: false,
                    paperPhase: true,
                    shadowPhase: true,
                    deploymentStage: 'PAPER_SHADOW',
                    canonicalDecision: 'xau-pd-level-break-4h-canonical-decision-2026-03-26',
                },
                executionConfigJson: executionConfig,
                status: 'ACTIVE',
                stateVersion: 1,
            },
        });
        console.log(`[ok] IndicatorInstance created: ${instance.id}`);

        // ── 6. Create automation binding ─────────────────────────────────
        const riskConfig = {
            riskPercent: 1.5,
            maxOpenPositions: 1,
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
                name: 'Paper Shadow: XAU H4 PD Level Break Long',
                statusReason: '[paper-shadow] Canonical PD Level Break 4H baseline, 1.5% non-compound, engine guards disabled',
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
        console.log(`Engine:     paper/shadow baseline`);
        console.log('Guards:     none (all engine trade guards disabled)');
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
