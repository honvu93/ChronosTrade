"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { AppLocale, DEFAULT_APP_LOCALE } from "@/lib/appLocale";
import { APP_LOCALE_STORAGE_KEY } from "@/lib/localeStorage";

interface LocaleStoreState {
    locale: AppLocale;
    setLocale: (locale: AppLocale) => void;
}

export const useLocaleStore = create<LocaleStoreState>()(
    persist(
        (set) => ({
            locale: DEFAULT_APP_LOCALE,
            setLocale: (locale) => set({ locale }),
        }),
        {
            name: APP_LOCALE_STORAGE_KEY,
            storage: createJSONStorage(() => window.localStorage),
            partialize: (state) => ({ locale: state.locale }),
        },
    ),
);
