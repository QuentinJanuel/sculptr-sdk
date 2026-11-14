import { getImageKind } from "../resources/sprite";

export interface ImageSize {
  width: number;
  height: number;
}

export interface ImageRect extends ImageSize {
  x: number;
  y: number;
}

/** `\x89PNG\r\n\x1a\n` */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * A PNG's dimensions, read from its header -- so no decoder, in either host.
 */
export const pngSize = function (png: Uint8Array): ImageSize {
  if (png.length < 24 || PNG_MAGIC.some((byte, index) => png[index] !== byte)) {
    throw new Error("that is not a PNG");
  }
  const read = (at: number): number =>
    ((png[at]! << 24) | (png[at + 1]! << 16) | (png[at + 2]! << 8) | png[at + 3]!) >>> 0;
  return { width: read(16), height: read(20) };
};

const checkRect = function (rect: ImageRect, within: ImageSize): void {
  if (rect.width <= 0 || rect.height <= 0) throw new Error("a slice needs a positive size");
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > within.width ||
    rect.y + rect.height > within.height
  ) {
    throw new Error(
      `slice ${rect.width}x${rect.height} at ${rect.x},${rect.y} falls outside a ` +
        `${within.width}x${within.height} picture`,
    );
  }
};

/**
 * One rectangle of a picture, as its own PNG.
 */
export const sliceImage = async function (png: Uint8Array, rect: ImageRect): Promise<Uint8Array> {
  checkRect(rect, pngSize(png));

  if (typeof OffscreenCanvas === "function" && typeof createImageBitmap === "function") {
    const kind = getImageKind(png);
    if (!kind) throw new Error("that is not a PNG, JPEG or BMP");
    const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: kind.type }));
    try {
      const canvas = new OffscreenCanvas(rect.width, rect.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.drawImage(
        bitmap,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        rect.width,
        rect.height,
      );
      const blob = await canvas.convertToBlob({ type: "image/png" });
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      bitmap.close();
    }
  }

  throw new Error("this host has no canvas to slice a picture with");
};
