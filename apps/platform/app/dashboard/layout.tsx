import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ConsoleShell } from "@/components/console/console-shell";

export const metadata: Metadata = {
  title: "Console — owneX",
  description:
    "Manage identities, roles and asset custody. Roles are read from the chain on every request.",
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
