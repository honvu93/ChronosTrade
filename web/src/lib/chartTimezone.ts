import { UTCTimestamp } from 'lightweight-charts';

/**
 * Display timezone offset for charts.
 * Lightweight Charts only understands UTC timestamps — to display in a
 * different timezone we shift the raw UTC seconds by the desired offset.
 */
const DISPLAY_TZ_OFFSET_HOURS = 7;  // GMT+7 (Asia/Ho_Chi_Minh)
const DISPLAY_TZ_OFFSET_SEC = DISPLAY_TZ_OFFSET_HOURS * 3600;

/** IANA timezone name used by Luxon / Intl for formatted strings. */
export const DISPLAY_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** Convert an ISO date string (UTC) to a chart-ready UTCTimestamp in display timezone. */
export function toChartTimestamp(isoOrDate: string | Date): UTCTimestamp {
    const ms = typeof isoOrDate === 'string' ? new Date(isoOrDate).getTime() : isoOrDate.getTime();
    return (Math.floor(ms / 1000) + DISPLAY_TZ_OFFSET_SEC) as UTCTimestamp;
}

/** Convert a UTC unix-seconds value to chart-display seconds. */
export function shiftToDisplayTz(utcSeconds: number): UTCTimestamp {
    return (utcSeconds + DISPLAY_TZ_OFFSET_SEC) as UTCTimestamp;
}

/** Reverse: convert chart-display seconds back to true UTC seconds. */
export function shiftToUtc(displaySeconds: number): number {
    return displaySeconds - DISPLAY_TZ_OFFSET_SEC;
}
