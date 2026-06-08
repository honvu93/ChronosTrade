import { TrainValSplit, WalkForwardFold } from './optimizationTypes';

export function splitDateRange(from: Date, to: Date, trainPct = 70): TrainValSplit {
  const totalMs = to.getTime() - from.getTime();
  const splitPoint = new Date(from.getTime() + totalMs * (trainPct / 100));
  return {
    trainFrom: from,
    trainTo: splitPoint,
    valFrom: splitPoint,
    valTo: to,
    trainPct,
  };
}

export function formatSplitInfo(split: TrainValSplit): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return `Train: ${fmt(split.trainFrom)} → ${fmt(split.trainTo)} | Val: ${fmt(split.valFrom)} → ${fmt(split.valTo)} (${split.trainPct}/${100 - split.trainPct})`;
}

// ─── Walk-Forward Folds ──────────────────────────────────────────────────────

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/**
 * Generate rolling walk-forward folds.
 *
 * Default: 12-month train, 6-month test, step 6 months.
 * With step=testMonths the test windows are contiguous (no overlap).
 */
export function generateWalkForwardFolds(
  dataFrom: Date,
  dataTo: Date,
  trainMonths = 12,
  testMonths = 6,
  stepMonths = 6,
): WalkForwardFold[] {
  const folds: WalkForwardFold[] = [];
  let foldIndex = 0;
  let cursor = new Date(dataFrom);

  while (true) {
    const trainFrom = new Date(cursor);
    const trainTo = addMonths(cursor, trainMonths);
    const testFrom = new Date(trainTo);
    const testEnd = addMonths(trainTo, testMonths);
    const testTo = testEnd > dataTo ? new Date(dataTo) : testEnd;

    // Need at least 1 month of test data
    if (addMonths(testFrom, 1) > dataTo) break;

    folds.push({ foldIndex, trainFrom, trainTo, testFrom, testTo });
    foldIndex++;
    cursor = addMonths(cursor, stepMonths);
  }

  return folds;
}

export function formatFoldInfo(fold: WalkForwardFold): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return `Fold ${fold.foldIndex + 1}: Train ${fmt(fold.trainFrom)}→${fmt(fold.trainTo)} | Test ${fmt(fold.testFrom)}→${fmt(fold.testTo)}`;
}
