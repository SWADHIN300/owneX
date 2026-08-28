import type { Metadata } from "next";

import { MintWizard } from "@/components/console/assets/mint-wizard";

export const metadata: Metadata = {
  title: "Mint a certificate — owneX",
  description:
    "Create an asset certificate: the confidential record stays encrypted, the chain gets its fingerprint.",
};

export default function MintPage() {
  return <MintWizard />;
}
