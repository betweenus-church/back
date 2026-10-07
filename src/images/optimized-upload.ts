import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";

export type ImageUpload = { buffer: Buffer; size: number; mimetype: string };

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_EDGE = 1600;

export async function optimizeImage(file: ImageUpload, maxEdge = MAX_EDGE, square = false): Promise<{ buffer: Buffer; ext: "webp" }> {
  if (!file.buffer?.length || file.size > MAX_UPLOAD_BYTES || file.buffer.length > MAX_UPLOAD_BYTES)
    throw new BadRequestException("Image must be 10 MB or smaller");

  try {
    const image = sharp(file.buffer, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS });
    const metadata = await image.metadata();
    const mime = ({ jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as Record<string, string>)[metadata.format ?? ""];
    if (!mime || file.mimetype !== mime || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1)
      throw new BadRequestException("Only valid, single-frame JPEG, PNG and WebP images are supported");
    if (metadata.width * metadata.height > MAX_INPUT_PIXELS)
      throw new BadRequestException("Image dimensions are too large");

    // rotate() applies EXIF orientation; re-encoding also strips camera metadata.
    const buffer = await image.rotate().resize(maxEdge, maxEdge,
      square ? { fit: "cover", position: "centre" } : { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 }).toBuffer();
    return { buffer, ext: "webp" };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException("Invalid or damaged image");
  }
}
