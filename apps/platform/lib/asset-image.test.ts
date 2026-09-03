import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ASSET_IMAGE_MAX_BYTES,
  assetImageTypes,
  hasAssetImageSignature,
  isAssetImageType,
} from "./asset-image.ts";

const bytes = (...values: number[]) => new Uint8Array(values);

test("only the three public asset image MIME types are accepted", () => {
  assert.deepEqual(Object.keys(assetImageTypes), ["image/png", "image/jpeg", "image/webp"]);
  assert.equal(isAssetImageType("image/png"), true);
  assert.equal(isAssetImageType("image/jpeg"), true);
  assert.equal(isAssetImageType("image/webp"), true);
  assert.equal(isAssetImageType("image/svg+xml"), false);
  assert.equal(isAssetImageType("text/html"), false);
  assert.equal(ASSET_IMAGE_MAX_BYTES, 5 * 1024 * 1024);
});

test("valid PNG, JPEG and WebP file signatures are accepted", () => {
  assert.equal(hasAssetImageSignature("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), true);
  assert.equal(hasAssetImageSignature("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)), true);
  assert.equal(hasAssetImageSignature("image/webp", bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)), true);
});

test("mismatched or truncated file contents are rejected", () => {
  const html = new TextEncoder().encode("<html>not an image</html>");
  assert.equal(hasAssetImageSignature("image/png", html), false);
  assert.equal(hasAssetImageSignature("image/jpeg", html), false);
  assert.equal(hasAssetImageSignature("image/webp", html), false);
  assert.equal(hasAssetImageSignature("image/png", bytes(0x89, 0x50)), false);
  assert.equal(hasAssetImageSignature("image/jpeg", bytes(0xff, 0xd8)), false);
  assert.equal(hasAssetImageSignature("image/webp", bytes(0x52, 0x49, 0x46, 0x46)), false);
});
