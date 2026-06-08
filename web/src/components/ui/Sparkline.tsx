"use client";

import React from 'react';

interface SparklineProps {
    data: number[];
    isUp: boolean;
    width?: number;
    height?: number;
}

export default function Sparkline({ data, isUp, width = 60, height = 24 }: SparklineProps) {
    if (!data || data.length < 2) return <div style={{ width, height }} />;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const points = data.map((val, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((val - min) / range) * height;
        return `${x},${y}`;
    }).join(' ');

    const color = isUp ? '#26C870' : '#F6465D';

    return (
        <svg width={width} height={height} className="overflow-visible">
            <polyline
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={points}
                style={{ filter: `drop-shadow(0 0 2px ${color}44)` }}
            />
        </svg>
    );
}
