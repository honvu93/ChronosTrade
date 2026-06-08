"use client";

import { type ReactNode } from "react";
import WorkspaceContextBar from "./WorkspaceContextBar";
import IndicatorOverlayPanel from "@/components/chart/IndicatorOverlayPanel";
import DataFreshnessBar from "@/components/chart/DataFreshnessBar";
import DataFreshnessPoller from "@/components/chart/DataFreshnessPoller";
import ConnectionStatusBar from "@/components/chart/ConnectionStatusBar";

interface ChartLandingSurfaceProps {
  landingLabel: string;
  chartSlot: ReactNode;
}

export default function ChartLandingSurface({
  landingLabel,
  chartSlot,
}: ChartLandingSurfaceProps) {
  return (
    <div className="absolute inset-0 flex flex-col">
      <DataFreshnessPoller />
      <WorkspaceContextBar landingLabel={landingLabel} />
      <DataFreshnessBar />
      <ConnectionStatusBar />
      <div className="relative min-h-0 flex-1">
        {chartSlot}
        <IndicatorOverlayPanel />
      </div>
    </div>
  );
}
