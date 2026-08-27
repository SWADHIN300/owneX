import type { Metadata } from "next";

import { RolesScreen } from "@/components/console/roles/roles-screen";

export const metadata: Metadata = {
  title: "Roles and permissions — owneX",
  description:
    "The permission matrix for your organisation, read from the contract: defaults, overrides, and what each role may do today.",
};

export default function RolesPage() {
  return <RolesScreen />;
}
