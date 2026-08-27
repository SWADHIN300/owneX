"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light and dark mode.
 *
 * White is the primary theme, so it is the default and the app does not follow
 * the operating system preference. Dark is opt-in through the header toggle, and
 * the choice is remembered for the next visit.
 *
 * `attribute="class"` puts `.dark` on <html>, which is what the token layer in
 * globals.css switches on. next-themes injects its own pre-paint script, so a
 * visitor who chose dark never sees a flash of white on load.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      themes={["light", "dark"]}
      enableSystem={false}
      disableTransitionOnChange
      storageKey="ownex.theme"
    >
      {children}
    </NextThemesProvider>
  );
}
