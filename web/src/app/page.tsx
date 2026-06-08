"use client";

import AccessGate from "@/components/auth/AccessGate";
import MainLayout from "@/components/layout/MainLayout";
import MultiPaneChart from "@/components/chart/MultiPaneChart";
import SyncStatus from "@/components/ui/SyncStatus";
import UrlSync from "@/components/layout/UrlSync";
import ChartLandingSurface from "@/components/layout/ChartLandingSurface";
import WatchlistPanel from "@/components/layout/WatchlistPanel";
import { useAuthenticatedEntry } from "@/components/layout/useAuthenticatedEntry";

export default function Home() {
  const { landingLabel } = useAuthenticatedEntry();

  return (
    <AccessGate requiredModules={["chart"]}>
      <MainLayout
        rightSidebar={<WatchlistPanel />}
      >
        <UrlSync />
        <ChartLandingSurface landingLabel={landingLabel} chartSlot={<MultiPaneChart />} />
        <div className="absolute bottom-4 right-4 z-20">
          <SyncStatus />
        </div>
      </MainLayout>
    </AccessGate>
  );
}
