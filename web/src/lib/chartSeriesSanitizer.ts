type ChartTimePoint = {
    time: number;
};

export const sanitizeChartSeries = <T extends ChartTimePoint>(points: T[]): T[] => (
    Array.from(
        new Map(
            [...points]
                .sort((left, right) => left.time - right.time)
                .map((point) => [point.time, point]),
        ).values(),
    )
);
