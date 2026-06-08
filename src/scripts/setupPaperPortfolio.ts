/**
 * setupPaperPortfolio.ts
 *
 * Parametric batch paper portfolio setup. Creates an IndicatorInstance +
 * AutomationBinding per signal code, using conservative defaults suitable for
 * a paper trading phase.
 *
 * Usage:
 *   ts-node src/scripts/setupPaperPortfolio.ts \
 *     --signals=SYS_4TF_PD_LEVEL_BREAK_LONG,OTHER_SIGNAL \
 *     --accountId=<paper-account-id> \
 *     --symbol=XAUUSD \
 *     --timeframe=H1 \
 *     --riskPct=0.5
 *
 * Or using PAPER_ACCOUNT_ID env var:
 *   PAPER_ACCOUNT_ID=xxx ts-node src/scripts/setupPaperPortfolio.ts \
 *     --signals=SYS_4TF_PD_LEVEL_BREAK_LONG \
 *     --symbol=XAUUSD --timeframe=H1
 *
 * Each binding is created in ACTIVE status with mode AUTO_EXECUTE.
 * Conservative guardrails: maxDailyLossPct = 3×riskPct, killSwitchDrawdownPct = 15%.
 */

import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { getTier1ComposedSignalSeeds } from '../services/signals/tier1ComposedSignals';

dotenv.config();

interface CliOptions {
    signals: string[];
    accountId: string;
    symbol: string;
    timeframe: string;
    riskPct: number;
    maxOpenPositions: number;
    dryRun: boolean;
}

const parseCsv = (raw: string) => raw.split(',').map((s) => s.trim()).filter(Boolean);

function parseArgs(argv: string[]): CliOptions {
    let signals: string[] = [];
    let accountId = process.env.PAPER_ACCOUNT_ID ?? '';
    let symbol = 'XAUUSD';
    let timeframe = 'H1';
    let riskPct = 0.5;
    let maxOpenPositions = 1;
    let dryRun = false;

    for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
            console.log('Usage: ts-node src/scripts/setupPaperPortfolio.ts [options]');
            console.log('  --signals=CODE1,CODE2        Signal codes to setup (required)');
            console.log('  --accountId=<id>             Paper account ID (or set PAPER_ACCOUNT_ID env)');
            console.log('  --symbol=XAUUSD              Trading symbol (default: XAUUSD)');
            console.log('  --timeframe=H1               Timeframe (default: H1)');
            console.log('  --riskPct=0.5                Risk percent per trade (default: 0.5)');
            console.log('  --maxOpenPositions=1         Max open positions per binding (default: 1)');
            console.log('  --dry-run                    Preview without writing to DB');
            process.exit(0);
        }
        if (arg.startsWith('--signals=')) signals = parseCsv(arg.split('=').slice(1).join('='));
        else if (arg.startsWith('--accountId=')) accountId = arg.split('=').slice(1).join('=').trim();
        else if (arg.startsWith('--symbol=')) symbol = arg.split('=').slice(1).join('=').trim().toUpperCase();
        else if (arg.startsWith('--timeframe=')) timeframe = arg.split('=').slice(1).join('=').trim().toUpperCase();
        else if (arg.startsWith('--riskPct=')) riskPct = Math.max(0.01, Number(arg.split('=')[1]) || 0.5);
        else if (arg.startsWith('--maxOpenPositions=')) maxOpenPositions = Math.max(1, Math.trunc(Number(arg.split('=')[1])) || 1);
        else if (arg === '--dry-run') dryRun = true;
    }

    if (signals.length === 0) {
        throw new Error('--signals is required. Example: --signals=SYS_4TF_PD_LEVEL_BREAK_LONG');
    }
    if (!accountId) {
        throw new Error('--accountId is required (or set PAPER_ACCOUNT_ID env var).');
    }

    return { signals, accountId, symbol, timeframe, riskPct, maxOpenPositions, dryRun };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));

    const prisma = new PrismaClient();

    try {
        // Validate paper account
        const account = await prisma.tradingAccount.findUnique({ where: { id: options.accountId } });
        if (!account) throw new Error(`Trading account ${options.accountId} not found.`);
        if (account.accountMode !== 'PAPER') throw new Error(`Account ${account.label} is not PAPER mode (got: ${account.accountMode}).`);
        console.log(`[Portfolio] Account: ${account.label} (${account.accountMode}, status: ${account.status})`);

        // Lookup signal versions from tier-1 seeds
        const seeds = getTier1ComposedSignalSeeds();
        const signalMap = new Map(seeds.map((s) => [s.code, s]));

        const unknownCodes = options.signals.filter((code) => !signalMap.has(code));
        if (unknownCodes.length > 0) {
            throw new Error(`Unknown signal code(s): ${unknownCodes.join(', ')}. Check getTier1ComposedSignalSeeds().`);
        }

        console.log(`[Portfolio] Setting up ${options.signals.length} signal(s) on ${options.symbol} ${options.timeframe}`);
        console.log(`[Portfolio] Risk: ${options.riskPct}% per trade, maxOpenPositions: ${options.maxOpenPositions}`);
        if (options.dryRun) console.log('[Portfolio] DRY RUN — no DB writes');

        const results: Array<{ signalCode: string; instanceId?: string; bindingId?: string; error?: string }> = [];

        for (const signalCode of options.signals) {
            const seed = signalMap.get(signalCode)!;

            // Verify signal definition exists in DB
            const signalDef = await prisma.signalDefinition.findUnique({
                where: { code_version: { code: seed.code, version: seed.version } },
            });
            if (!signalDef) {
                console.warn(`[Portfolio] WARNING: Signal definition ${seed.code} v${seed.version} not in DB — run seed:signals first.`);
                results.push({ signalCode, error: `Signal definition not found. Run: npm run seed:signals` });
                continue;
            }

            const riskConfig = {
                riskPercent: options.riskPct,
                maxOpenPositions: options.maxOpenPositions,
            };

            const guardrails = {
                maxOpenPositions: options.maxOpenPositions,
                maxDailyLossPct: round(options.riskPct * 3, 2), // 3× single trade loss = daily stop
                killSwitchDrawdownPct: 15,
            };

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

            const bindingName = `Paper: ${seed.name ?? seed.code} ${options.symbol} ${options.timeframe}`;
            const instanceName = `Live: ${seed.name ?? seed.code} ${options.symbol} ${options.timeframe} (Paper)`;

            if (options.dryRun) {
                console.log(`[Portfolio] [DRY RUN] Would create: ${signalCode} v${seed.version}`);
                console.log(`  Instance: "${instanceName}"`);
                console.log(`  Binding:  "${bindingName}" — risk ${options.riskPct}%, guardrails: daily -${guardrails.maxDailyLossPct}%, kill switch -15%`);
                results.push({ signalCode });
                continue;
            }

            try {
                const instance = await prisma.indicatorInstance.create({
                    data: {
                        name: instanceName,
                        signalCode: seed.code,
                        signalVersion: seed.version,
                        symbol: options.symbol,
                        timeframe: options.timeframe,
                        parameterJson: { paperPhase: true },
                        executionConfigJson: executionConfig,
                        status: 'ACTIVE',
                        stateVersion: 1,
                    },
                });

                const binding = await prisma.tradingAutomationBinding.create({
                    data: {
                        accountId: options.accountId,
                        indicatorInstanceId: instance.id,
                        name: bindingName,
                        status: 'ACTIVE',
                        mode: 'AUTO_EXECUTE',
                        approvalRequired: false,
                        killSwitchActive: false,
                        riskConfigJson: riskConfig,
                        guardrailsJson: guardrails,
                        approvedAt: new Date(),
                    },
                });

                console.log(`[Portfolio] Created: ${signalCode} | instance=${instance.id} | binding=${binding.id}`);
                results.push({ signalCode, instanceId: instance.id, bindingId: binding.id });
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                console.error(`[Portfolio] FAILED: ${signalCode} — ${msg}`);
                results.push({ signalCode, error: msg });
            }
        }

        // Summary
        console.log('');
        console.log('[Portfolio] Done');
        const successful = results.filter((r) => !r.error && !options.dryRun);
        const failed = results.filter((r) => r.error);
        console.log(`  Created: ${successful.length}/${options.signals.length}`);
        if (failed.length > 0) {
            console.log(`  Failed: ${failed.length}`);
            for (const r of failed) {
                console.log(`    - ${r.signalCode}: ${r.error}`);
            }
        }

        if (successful.length > 0 && !options.dryRun) {
            console.log('');
            console.log('Next steps:');
            console.log('  1. Verify bindings in the UI: /trading?tab=automation');
            console.log('  2. Ensure MT5 bridge is running and paper account is connected');
            console.log('  3. Monitor first few intents in /trading?tab=intents');
        }
    } finally {
        await prisma.$disconnect();
    }
}

function round(value: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
});
