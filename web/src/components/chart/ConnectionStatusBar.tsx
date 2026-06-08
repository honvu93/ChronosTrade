"use client";

import { WifiOff, RefreshCw, AlertCircle } from "lucide-react";
import { useConnectionStatus, type ConnectionStatus } from "@/store/useConnectionStatus";

interface ConnectionStatusBarProps {
  /** Override connection status (e.g. for SSR-based unit tests). Falls back to store. */
  connectionStatusOverride?: ConnectionStatus;
}

function getBarConfig(status: ConnectionStatus) {
  switch (status) {
    case "reconnecting":
      return {
        label: "Reconnecting",
        description:
          "Realtime socket interrupted - attempting to reconnect. Historical chart context is preserved.",
        Icon: RefreshCw,
        className:
          "border-semantic-warning/40 bg-semantic-warning/8 text-semantic-warning",
        iconClassName: "animate-spin",
      };
    case "failed":
      return {
        label: "Connection Failed",
        description:
          "Realtime socket is unavailable. Historical candles may still load; reload the page or verify socket configuration.",
        Icon: AlertCircle,
        className:
          "border-semantic-error/40 bg-semantic-error/8 text-semantic-error",
        iconClassName: "",
      };
    case "disconnected":
    default:
      return {
        label: "Disconnected",
        description:
          "Realtime socket is offline. Chart shows the last successful data load - context is preserved.",
        Icon: WifiOff,
        className:
          "border-semantic-warning/40 bg-semantic-warning/8 text-semantic-warning",
        iconClassName: "",
      };
  }
}

export default function ConnectionStatusBar({
  connectionStatusOverride,
}: ConnectionStatusBarProps) {
  const { status } = useConnectionStatus();
  const effectiveStatus = connectionStatusOverride ?? status;

  if (effectiveStatus === "connected") return null;

  const { label, description, Icon, className, iconClassName } =
    getBarConfig(effectiveStatus);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex items-center gap-2 border-b px-4 py-2 text-xs ${className}`}
    >
      <Icon
        size={13}
        className={`flex-shrink-0 ${iconClassName}`}
        aria-hidden="true"
      />
      <span className="font-bold">{label}:</span>
      <span>{description}</span>
    </div>
  );
}
