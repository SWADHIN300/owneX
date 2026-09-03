import type { Metadata } from "next";

import { ApplicationsScreen } from "@/components/console/applications/applications-screen";

export const metadata: Metadata = {
  title: "Applications — owneX",
  description:
    "Sign in with owneX: register an approved third-party website, configure its exact callback URLs, and choose which roles may sign in. Access is read from the contract, not a database flag.",
};

export default function ApplicationsPage() {
  return <ApplicationsScreen />;
}
