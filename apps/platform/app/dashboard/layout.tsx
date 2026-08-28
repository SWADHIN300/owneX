import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ToastProvider } from "@/components/ui";
import { ConsoleShell } from "@/components/console/console-shell";

export const metadata: Metadata = {
  title: "Console — owneX",
  description:
    "Manage identities, roles and asset custody. Roles are read from the chain on every request.",
};

/**
 * `ToastProvider` is mounted once here rather than per screen, so a message
 * raised while navigating survives the route change and there is only ever one
 * live region announcing them.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </ToastProvider>
  );
}
