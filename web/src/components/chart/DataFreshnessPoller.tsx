"use client";

import { useEffect, Suspense } from "react";
import { useMarketStore } from "@/store/useMarketStore";
import { useDataFreshness } from "@/store/useDataFreshness";
import { classifyFreshness } from "@/lib/freshnessUtils";

const POLL_INTERVAL_MS = 10_000;

function DataFreshnessPollLogic() {
  const { symbol, timeframe } = useMarketStore();
  const { setFreshness, setError } = useDataFreshness();

  useEffect(() => {
    if (!symbol || !timeframe) return;

    let mounted = true;

    const poll = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
        const response = await fetch(
          `${apiUrl}/api/sync-status/${symbol}?timeframe=${timeframe}`,
        );
        if (!response.ok) {
          if (mounted) setError();
          return;
        }
        const data: { latest: string | null; totalCandles: number } =
          await response.json();

        if (!mounted) return;
        setFreshness({
          state: classifyFreshness(data.latest, timeframe),
          latestTimestamp: data.latest,
          candleCount: data.totalCandles,
        });
      } catch {
        if (mounted) setError();
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [symbol, timeframe, setFreshness, setError]);

  return null;
}

/** Logic-only component — mounts a polling effect that keeps the DataFreshness store up to date. */
export default function DataFreshnessPoller() {
  return (
    <Suspense fallback={null}>
      <DataFreshnessPollLogic />
    </Suspense>
  );
}
