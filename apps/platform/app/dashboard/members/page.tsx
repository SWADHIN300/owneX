import type { Metadata } from "next";

import { MembersScreen } from "@/components/console/members/members-screen";

export const metadata: Metadata = {
  title: "Members — owneX",
  description:
    "Who belongs to your organisation, with the role and access expiry the contract holds for each wallet.",
};

export default function MembersPage() {
  return <MembersScreen />;
}
