import type { Metadata } from "next";

import { AssetVault } from "@/components/console/assets/asset-vault";

/**
 * The page stays a server component so the route keeps its metadata and no more
 * JavaScript is shipped than the vault widget itself needs. Only the widget is
 * a client component, because only it depends on the session.
 */
export const metadata: Metadata = {
  title: "Asset vault — owneX",
  description:
    "Asset certificates held by your organisation, with the on-chain integrity check for each one.",
};

export default function AssetsPage() {
  return <AssetVault />;
}
