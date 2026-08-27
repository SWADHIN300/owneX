import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AssetDetail } from "@/components/console/assets/asset-detail";

export const metadata: Metadata = {
  title: "Certificate — owneX",
  description:
    "Provenance, integrity check and public metadata for one asset certificate.",
};

/**
 * The token id is validated here, on the server, before any client component
 * runs. `/dashboard/assets/banana` is a bad URL rather than a screen that loads
 * and then reports that it found nothing.
 */
export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ tokenId: string }>;
}) {
  const { tokenId } = await params;
  const parsed = Number(tokenId);
  if (!Number.isInteger(parsed) || parsed <= 0) notFound();

  return <AssetDetail tokenId={parsed} />;
}
