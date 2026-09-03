import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyClaim } from "./asset-binding.ts";

const CURRENT = "0x5e07bfda18281ea3038e1adca27ff4aae5db37ba";
const PREVIOUS = "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0";

const CHAIN_HASH = "0x5f20f13b10b06e9673aaa8087356fe6ebbcd2873957377fb469f72e0bf0d40df";
const OTHER_HASH = "0xbbbd8c2b1a0a3f60e2a2e0cf4a1a3f0d5c8d2b7e6a9c0d1e2f3a4b5c6d7e8f90";

test("a row anchoring what the token holds is a real conflict, not something to overwrite", () => {
  assert.equal(classifyClaim({ assetHash: CHAIN_HASH, contractAddress: CURRENT }, CHAIN_HASH, CURRENT), "conflict");
});

test("a row the chain contradicts is stale and gets released", () => {
  // This is the case that wedged minting: an id left over from an earlier
  // AssetNFT, where token #5 was a different asset entirely.
  assert.equal(classifyClaim({ assetHash: OTHER_HASH, contractAddress: CURRENT }, CHAIN_HASH, CURRENT), "release");
});

test("an unstamped row is judged by its anchor, because that is all there is to go on", () => {
  assert.equal(classifyClaim({ assetHash: CHAIN_HASH }, CHAIN_HASH, CURRENT), "conflict");
  assert.equal(classifyClaim({ assetHash: OTHER_HASH }, CHAIN_HASH, CURRENT), "release");
  assert.equal(classifyClaim({ assetHash: OTHER_HASH, contractAddress: null }, CHAIN_HASH, CURRENT), "release");
});

test("a row belonging to another deployment is left alone, whatever it anchors", () => {
  assert.equal(
    classifyClaim({ assetHash: CHAIN_HASH, contractAddress: PREVIOUS }, CHAIN_HASH, CURRENT),
    "other-deployment"
  );
  assert.equal(
    classifyClaim({ assetHash: OTHER_HASH, contractAddress: PREVIOUS }, CHAIN_HASH, CURRENT),
    "other-deployment"
  );
});

test("address and hash comparison is case-insensitive, so a checksummed value behaves the same", () => {
  assert.equal(
    classifyClaim({ assetHash: CHAIN_HASH.toUpperCase().replace("0X", "0x"), contractAddress: CURRENT.toUpperCase().replace("0X", "0x") }, CHAIN_HASH, CURRENT),
    "conflict"
  );
});

test("no verdict silently drops a claim: every input resolves to one of the three", () => {
  const verdicts = new Set(
    [CURRENT, PREVIOUS, null, undefined].flatMap((contractAddress) =>
      [CHAIN_HASH, OTHER_HASH].map((assetHash) => classifyClaim({ assetHash, contractAddress }, CHAIN_HASH, CURRENT))
    )
  );

  for (const verdict of verdicts) {
    assert.ok(["conflict", "release", "other-deployment"].includes(verdict), `unexpected verdict ${verdict}`);
  }
  assert.equal(verdicts.size, 3);
});
