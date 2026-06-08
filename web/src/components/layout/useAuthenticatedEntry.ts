"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import {
  getAuthenticatedEntryState,
  type AuthenticatedEntryState,
} from "./authenticatedEntry";
import { useAuthStore } from "@/store/useAuthStore";
import { useAppLocale } from "@/hooks/useAppLocale";

export function useAuthenticatedEntry(): AuthenticatedEntryState {
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((state) => state.status === "authenticated" && Boolean(state.session));
  const { locale } = useAppLocale();

  return useMemo(
    () => getAuthenticatedEntryState({
      pathname,
      isAuthenticated,
      locale,
    }),
    [isAuthenticated, locale, pathname],
  );
}
