import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });
console.log('Using DATABASE_URL:', process.env.DATABASE_URL);

const prisma = new PrismaClient();

const TF_MINUTES = {
    '1m': 1,
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '1h': 60,
    '2h': 120,
    '3h': 180,
    '4h': 240,
    '12h': 720,
    '1d': 1440,
    '3d': 4320,
    '1w': 10080,
};

function isWeekend(date: Date): boolean {
    const day = date.getUTCDay();
    // Saturday = 6, Sunday = 0
    return day === 6 || day === 0;
}

// Better approach for checking if a timestamp falls during MT5 weekend closure
// Friday 23:55 to Sunday 23:05 (MT5 server time GMT+3) roughly translates to Friday 21:00 UTC to Sunday 21:00 UTC
function isMetalTradingClosed(date: Date): boolean {
    const day = date.getUTCDay();
    const hour = date.getUTCHours();

    // Saturday is entirely closed
    if (day === 6) return true;

    // Friday after 21:00 UTC is closed
    if (day === 5 && hour >= 21) return true;

    // Sunday before 22:00 UTC is closed
    if (day === 0 && hour < 22) return true;

    return false;
}

async function checkGaps() {
    const targetSymbols = ['BTCUSD', 'XAUUSD', 'XAGUSD'];
    const targetTfs = ['1d', '4h', '1h', '15m', '5m', '1m']; // From largest to smallest

    const report: Record<string, any[]> = {};

    for (const symbol of targetSymbols) {
        for (const tf of targetTfs) {
            if (!TF_MINUTES[tf as keyof typeof TF_MINUTES]) continue;

            console.log(`Checking ${symbol} ${tf}...`);

            const candles = await prisma.candle.findMany({
                where: { symbol, timeframe: tf },
                orderBy: { time: 'asc' },
                select: { time: true }
            });

            if (candles.length < 2) {
                console.log(`Skipping ${symbol} ${tf} - Not enough candles (${candles.length})`);
                continue;
            }

            const expectedGapMs = TF_MINUTES[tf as keyof typeof TF_MINUTES] * 60 * 1000;
            const gaps = [];

            for (let i = 1; i < candles.length; i++) {
                const prev = candles[i - 1].time;
                const curr = candles[i].time;
                const diffMs = curr.getTime() - prev.getTime();

                if (diffMs > expectedGapMs) {
                    const numMissing = Math.floor(diffMs / expectedGapMs) - 1;
                    if (numMissing <= 0) continue;

                    let isSkip = false;

                    if (symbol.includes('XAU') || symbol.includes('XAG')) {
                        // For metals, check if the gap spans across the weekend closure
                        // If the gap starts late Friday and ends early Monday, it's normal
                        const isPrevClosed = isMetalTradingClosed(prev) || isMetalTradingClosed(new Date(prev.getTime() + expectedGapMs));
                        const isCurrClosed = isMetalTradingClosed(curr) || isMetalTradingClosed(new Date(curr.getTime() - expectedGapMs));

                        // If difference is roughly a weekend (48 hours) and falls on weekend days
                        // OR if we sample the middle of the gap and it's closed
                        const midPoint = new Date(prev.getTime() + diffMs / 2);
                        if (isMetalTradingClosed(midPoint)) {
                            // Actually count how many open bars are missing
                            let missingOpenBars = 0;
                            let temp = new Date(prev.getTime() + expectedGapMs);
                            while (temp < curr) {
                                if (!isMetalTradingClosed(temp)) {
                                    missingOpenBars++;
                                }
                                temp = new Date(temp.getTime() + expectedGapMs);
                            }

                            if (missingOpenBars <= 2) { // Allow tiny threshold for early close/late open
                                isSkip = true;
                            }
                        }
                    }

                    if (!isSkip) {
                        gaps.push({
                            start: prev.toISOString(),
                            end: curr.toISOString(),
                            missingBars: numMissing,
                            durationHours: (diffMs / (1000 * 60 * 60)).toFixed(2)
                        });
                    }
                }
            }

            if (gaps.length > 0) {
                gaps.sort((a, b) => b.missingBars - a.missingBars); // Sort by largest gaps first
                report[`${symbol}_${tf}`] = gaps;
                console.log(`Found ${gaps.length} gaps for ${symbol} ${tf}. Largest: ${gaps[0].missingBars} bars.`);
            } else {
                console.log(`No gaps found for ${symbol} ${tf}.`);
            }
        }
    }

    // Write detailed report to file
    fs.writeFileSync('gap_report.json', JSON.stringify(report, null, 2));

    // Print summary to console
    console.log("\n=== GAP SUMMARY ===");
    for (const key in report) {
        if (report[key] && report[key].length > 0) {
            console.log(`\n[${key}] Total gaps: ${report[key].length}`);
            console.log(`Top 3 largest gaps:`);
            report[key].slice(0, 3).forEach(g => {
                console.log(`  - ${g.start} to ${g.end} | Missing: ${g.missingBars} bars | Duration: ${g.durationHours}h`);
            });
        }
    }
}

checkGaps()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
