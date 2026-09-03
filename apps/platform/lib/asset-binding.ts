/**
 * Who may hold a token id.
 *
 * A token id is unique within one AssetNFT deployment, not globally: every
 * deployment starts counting at 1. So a row saying `token_id = 5` is a claim
 * about a specific contract, and the only thing that can settle the claim is the
 * anchor the chain holds for that token.
 *
 * This is the pure half of POST /api/assets/<id>/confirm, kept separate because
 * the rule is the interesting part and a rule worth trusting is a rule worth
 * testing without a database or an RPC endpoint.
 */

export type ExistingClaim = {
  /** keccak256 anchor stored on the claiming row. */
  assetHash: string;
  /** The deployment the row was stamped with, if it has been stamped at all. */
  contractAddress?: string | null;
};

export type ClaimVerdict =
  /** The row describes another deployment's token. Not this server's business. */
  | "other-deployment"
  /** The chain agrees with the row: two records genuinely want one token. */
  | "conflict"
  /** The chain contradicts the row: the binding is stale and should be released. */
  | "release";

const sameHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function classifyClaim(
  claim: ExistingClaim,
  chainAssetHash: string,
  deploymentContractAddress: string
): ClaimVerdict {
  if (claim.contractAddress && !sameHex(claim.contractAddress, deploymentContractAddress)) {
    return "other-deployment";
  }

  // An unstamped row predates deployment scoping, so it is judged purely on its
  // anchor — which is the same test a stamped row gets, and the only test that
  // survives a redeploy.
  return sameHex(claim.assetHash, chainAssetHash) ? "conflict" : "release";
}
