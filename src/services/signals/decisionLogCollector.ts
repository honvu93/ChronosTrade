import type {
    DecisionLogEntry,
    DecisionConditionEntry,
    DecisionAction,
    DecisionStateSnapshot,
} from './types';

export class DecisionLogCollector {
    private entries: DecisionLogEntry[] = [];
    private currentConditions: DecisionConditionEntry[] = [];
    private currentBarIndex = 0;
    private currentTimestamp = new Date(0);
    private currentOhlcv = { open: 0, high: 0, low: 0, close: 0, volume: 0 };
    private currentSnapshot: DecisionStateSnapshot = {
        activeStop: 0,
        remainingFraction: 1,
        realizedNetR: 0,
        movedToBreakeven: false,
        partialTaken: false,
        maxDrawdownPct: 0,
    };
    private barStarted = false;

    startBar(
        barIndex: number,
        timestamp: Date,
        ohlcv: { open: number; high: number; low: number; close: number; volume: number },
        snapshot: DecisionStateSnapshot,
    ): void {
        if (this.barStarted) {
            this.endBar('HOLD');
        }
        this.currentBarIndex = barIndex;
        this.currentTimestamp = timestamp;
        this.currentOhlcv = ohlcv;
        this.currentSnapshot = { ...snapshot };
        this.currentConditions = [];
        this.barStarted = true;
    }

    recordCondition(name: string, triggered: boolean, skipped = false): void {
        this.currentConditions.push({
            name,
            result: skipped ? 'SKIPPED' : triggered ? 'TRIGGERED' : 'PASS',
        });
    }

    endBar(action: DecisionAction, updatedSnapshot?: DecisionStateSnapshot): void {
        if (!this.barStarted) return;
        this.entries.push({
            barIndex: this.currentBarIndex,
            timestamp: this.currentTimestamp,
            ohlcv: { ...this.currentOhlcv },
            conditions: [...this.currentConditions],
            action,
            stateSnapshot: updatedSnapshot ? { ...updatedSnapshot } : { ...this.currentSnapshot },
        });
        this.barStarted = false;
    }

    getLog(): DecisionLogEntry[] {
        if (this.barStarted) {
            this.endBar('HOLD');
        }
        return this.entries;
    }
}
