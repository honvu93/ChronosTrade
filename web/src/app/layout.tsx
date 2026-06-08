import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import AppChrome from "@/components/layout/AppChrome";
import { APP_LOCALE_STORAGE_KEY } from "@/lib/localeStorage";

export const metadata: Metadata = {
  title: "TV-GIT | Analytical Command Deck",
  description: "Chart-first research, validation, reporting, and runtime trading control in one analytical command deck.",
};

const localeBootstrapScript = `
(() => {
  try {
    const raw = window.localStorage.getItem("${APP_LOCALE_STORAGE_KEY}");
    let locale = "en";
    if (raw === "en" || raw === "vi") {
      locale = raw;
    } else if (raw) {
      const parsed = JSON.parse(raw);
      const candidate = parsed && typeof parsed === "object" ? parsed.state?.locale : null;
      if (candidate === "en" || candidate === "vi") {
        locale = candidate;
      }
    }
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    document.documentElement.dataset.intlLocale = locale === "vi" ? "vi-VN" : "en-US";
  } catch {
    document.documentElement.lang = "en";
    document.documentElement.dataset.locale = "en";
    document.documentElement.dataset.intlLocale = "en-US";
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="bg-bg-secondary text-text-primary antialiased font-sans flex h-screen flex-col overflow-hidden"
      >
        <script dangerouslySetInnerHTML={{ __html: localeBootstrapScript }} />
        <Providers>
          <AppChrome>{children}</AppChrome>
        </Providers>
      </body>
    </html>
  );
}
