export function toUtcRangeStart(value: string) {
    return `${value}T00:00:00.000Z`;
}

export function toUtcRangeEnd(value: string) {
    return `${value}T23:59:59.999Z`;
}

export function isUtcDayRangeInvalid(fromDate: string, toDate: string) {
    if (!fromDate || !toDate) {
        return false;
    }

    return new Date(toUtcRangeStart(fromDate)).getTime() > new Date(toUtcRangeEnd(toDate)).getTime();
}

export function buildUtcDayRangeSummary(fromDate: string, toDate: string) {
    if (!fromDate && !toDate) {
        return null;
    }

    return `UTC ${fromDate || "Open"} to ${toDate || "Open"}`;
}
