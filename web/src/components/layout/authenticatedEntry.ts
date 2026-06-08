import {
  AUTH_TOKEN_STORAGE_KEYS,
  getStoredAuthToken,
} from "@/lib/authTokenStorage";
import { AppLocale, DEFAULT_APP_LOCALE } from "@/lib/appLocale";
import { getTranslationCatalog } from "@/lib/translations";

export { AUTH_TOKEN_STORAGE_KEYS, getStoredAuthToken } from "@/lib/authTokenStorage";

export interface AuthenticatedEntryInput {
  pathname?: string;
  isAuthenticated?: boolean;
  storage?: Partial<Record<(typeof AUTH_TOKEN_STORAGE_KEYS)[number], string | null>>;
  locale?: AppLocale;
}

export interface AuthenticatedEntryState {
  entryPath: string;
  isAuthenticated: boolean;
  landingLabel: string;
}

export function hasAuthenticatedSession(
  {
    isAuthenticated,
    storage = {},
  }: Pick<AuthenticatedEntryInput, "isAuthenticated" | "storage"> = {},
): boolean {
  if (typeof isAuthenticated === "boolean") {
    return isAuthenticated;
  }

  return getStoredAuthToken(storage) !== null;
}

export function getAuthenticatedEntryState({
  pathname = "/",
  isAuthenticated,
  storage = {},
  locale = DEFAULT_APP_LOCALE,
}: AuthenticatedEntryInput = {}): AuthenticatedEntryState {
  const resolvedAuthenticated = hasAuthenticatedSession({ isAuthenticated, storage });
  const entryPath = "/";
  const isEntryRoute = pathname === entryPath;
  const copy = getTranslationCatalog(locale);

  return {
    entryPath,
    isAuthenticated: resolvedAuthenticated,
    landingLabel:
      resolvedAuthenticated && isEntryRoute
        ? copy.authenticatedEntry.authenticatedEntry
        : copy.authenticatedEntry.defaultLanding,
  };
}
