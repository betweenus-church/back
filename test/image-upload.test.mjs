import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { optimizeImage } from "../dist/images/optimized-upload.js";

test("keeps transparency and applies camera rotation while stripping metadata", async () => {
  const transparent = await sharp({ create: { width: 20, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const alphaResult = await optimizeImage({ buffer: transparent, size: transparent.length, mimetype: "image/png" });
  const alphaInfo = await sharp(alphaResult.buffer).metadata();
  assert.equal(alphaInfo.format, "webp");
  assert.equal(alphaInfo.hasAlpha, true);
  assert.equal(alphaInfo.orientation, undefined);

  const rotated = await sharp({ create: { width: 30, height: 20, channels: 3, background: "red" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const rotationResult = await optimizeImage({ buffer: rotated, size: rotated.length, mimetype: "image/jpeg" });
  const rotationInfo = await sharp(rotationResult.buffer).metadata();
  assert.equal(rotationInfo.width, 20);
  assert.equal(rotationInfo.height, 30);
  assert.equal(rotationInfo.orientation, undefined);
});

test("rejects mismatched MIME and malformed images", async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "blue" } }).png().toBuffer();
  await assert.rejects(optimizeImage({ buffer: png, size: png.length, mimetype: "image/jpeg" }), { status: 400 });
  await assert.rejects(optimizeImage({ buffer: png.subarray(0, 20), size: 20, mimetype: "image/png" }), { status: 400 });
});
