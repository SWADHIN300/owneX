import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Martian_Mono } from "next/font/google";
import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { WalletProvider } from "@/components/wallet/wallet-provider";

/**
 * Two faces, three jobs.
 *
 * Martian Mono is unusually wide and heavy for a monospace, which is why it can
 * carry an oversized display headline without looking like code. It also handles
 * addresses, hashes and micro labels, where fixed advance widths genuinely help.
 *
 * Geist Sans stays for paragraphs. Monospace measurably slows prose reading, so
 * body copy is deliberately not mono.
 *
 * If a Mingray Mono licence is bought later, swapping it in means changing this
 * file only: point `--font-display` and `--font-mono` at the new face.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const martianMono = Martian_Mono({
  variable: "--font-martian-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "owneX — Own it. Prove it.",
  description:
    "Verifiable identity, role-based access control, and NFT-backed asset ownership with a tamper-evident audit trail.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${martianMono.variable} h-full antialiased`}
      // next-themes sets the class on <html> before hydration, which the server
      // markup cannot know about.
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <WalletProvider>{children}</WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
