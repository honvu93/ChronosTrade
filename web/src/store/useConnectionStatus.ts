"use client";

import { create } from "zustand";

export type ConnectionStatus =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "failed";

interface ConnectionStatusStore {
  status: ConnectionStatus;
  setStatus: (status: ConnectionStatus) => void;
}

export const useConnectionStatus = create<ConnectionStatusStore>((set) => ({
  status: "disconnected",
  setStatus: (status) => set({ status }),
}));
