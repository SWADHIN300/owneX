/** Validation shared by the asset image upload endpoint and its focused tests. */

export const ASSET_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const assetImageTypes = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export type AssetImageType = keyof typeof assetImageTypes;

export function isAssetImageType(value: string): value is AssetImageType {
  return value in assetImageTypes;
}

/** Reject a renamed text/HTML file even when its browser-provided MIME type lies. */
export function hasAssetImageSignature(type: AssetImageType, bytes: Uint8Array): boolean {
  if (type === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }

  if (type === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  // RIFF....WEBP
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}
