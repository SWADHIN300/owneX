import type { Metadata } from "next";

import { ApplicationsScreen } from "@/components/console/applications/applications-screen";

export const metadata: Metadata = {
  title: "Applications — owneX",
  description:
    "Applications wired into single sign-on, and which roles may reach each one. Read from the contract, not a database flag.",
};

export default function ApplicationsPage() {
  return <ApplicationsScreen />;
}
