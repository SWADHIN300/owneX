import { z } from "zod";

import { requirePermission } from "@/lib/authz";
import { ApiError, badRequest, handler, okNoStore } from "@/lib/http";
import { db } from "@/lib/supabase";
import {
  ASSET_IMAGE_MAX_BYTES,
  assetImageTypes,
  hasAssetImageSignature,
  isAssetImageType,
} from "@/lib/asset-image";

/**
 * POST /api/assets/image
 *
 * Stores one display-safe asset photograph in the pre-existing public
 * `asset-images` bucket. The service role is kept server-side; callers are
 * authorised from the live on-chain MINT_ASSETS permission before any object is
 * written. Bucket objects are public deliberately: NFT metadata itself is
 * public, so images must never contain confidential documents or PII.
 */

const formSchema = z.object({
  orgId: z.coerce.number().int().positive(),
});

const BUCKET = "asset-images";

export const POST = handler(async (request: Request) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw badRequest("Image upload must use multipart form data");
  }

  const { orgId } = formSchema.parse({ orgId: form.get("orgId") });
  await requirePermission(orgId, "MINT_ASSETS");

  const image = form.get("image");
  if (!(image instanceof File)) throw badRequest("Choose an image file to upload");
  if (!isAssetImageType(image.type)) throw badRequest("Only PNG, JPEG, and WebP images are allowed");
  if (image.size === 0) throw badRequest("The image file is empty");
  if (image.size > ASSET_IMAGE_MAX_BYTES) throw badRequest("Image files must be 5 MB or smaller");

  const bytes = new Uint8Array(await image.arrayBuffer());
  if (!hasAssetImageSignature(image.type, bytes)) {
    throw badRequest("The file contents do not match the declared image type");
  }

  // The original filename is deliberately not used in the object key: it may
  // contain private information and is not needed to render the file.
  const path = `${orgId}/${crypto.randomUUID()}.${assetImageTypes[image.type]}`;
  const storage = db().storage.from(BUCKET);
  const { error } = await storage.upload(path, bytes, {
    contentType: image.type,
    cacheControl: "31536000",
    upsert: false,
  });

  if (error) {
    if (/bucket not found/i.test(error.message)) {
      throw new ApiError(500, "Asset image storage is not configured; create the asset-images bucket first");
    }
    console.error("[ownex] asset image upload failed:", error);
    throw new ApiError(500, "Could not upload the image");
  }

  const { data } = storage.getPublicUrl(path);
  return okNoStore({ url: data.publicUrl, path, contentType: image.type, size: image.size });
});
