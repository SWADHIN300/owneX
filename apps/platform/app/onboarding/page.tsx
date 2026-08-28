import type { Metadata } from "next";

import { Onboarding } from "@/components/onboarding/onboarding";

export const metadata: Metadata = {
  title: "Get started — owneX",
  description:
    "Create an identity anchored to your wallet, and an organisation if you are setting one up.",
};

export default function OnboardingPage() {
  return <Onboarding />;
}
