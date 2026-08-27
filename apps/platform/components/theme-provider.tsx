"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Theme switching.
 *
 * The pale lime canvas is the primary theme, so it lives on `:root` in
 * globals.css and loads by default. `.dark` is the deep green canvas, kept as the
 * opt-in alternate. The system preference is not followed, because the lime is the
 * brand rather than a mode.
 *
 * next-themes injects its own pre-paint script, so a visitor who chose dark never
 * sees a flash of lime on load, and the choice persists across visits.
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
