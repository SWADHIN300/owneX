import type { Metadata } from "next";

import { Overview } from "@/components/console/overview/overview";

export const metadata: Metadata = {
  title: "Overview — owneX",
  description:
    "What this wallet holds and what it may do, re-read from the chain on every request.",
};

export default function DashboardPage() {
  return <Overview />;
}
