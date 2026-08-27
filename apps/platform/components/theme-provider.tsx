"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Theme switching.
 *
 * The deep green canvas is the primary theme, so it lives on `:root` in
 * globals.css and is the default here. `.light` is the green-tinted alternate.
 * The system preference is not followed, because the green canvas is the brand
 * rather than a mode.
 *
 * next-themes injects its own pre-paint script, so a visitor who chose light
 * never sees a flash of green on load, and the choice persists.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      themes={["light", "dark"]}
      enableSystem={false}
      disableTransitionOnChange
      storageKey="ownex.theme"
    >
      {children}
    </NextThemesProvider>
  );
}
