// Windows icons (.ico) and cursors (.cur). libvips can only read these
// through ImageMagick, which is not something to expose to uploaded files, so
// Picsur handles them itself.
//
// An icon holds several images, usually of different sizes. The largest one is
// decoded: images stored as PNG are left to libvips, bitmaps with 1, 4, 8, 24
// or 32 bits per pixel are decoded here. Icons are written with PNG images.

export interface ICOBitmap {
  pixels: Buffer;
  width: number;
  height: number;
  channels: 4;
}

export type ICOImage = { png: Buffer } | { bitmap: ICOBitmap };

const DIRECTORY_SIZE = 6;
const ENTRY_SIZE = 16;
const TYPE_ICON = 1;
const TYPE_CURSOR = 2;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const BI_RGB = 0;

// Icons are made for small sizes, but the images in them can claim any size
export const ICO_MAX_PIXELS = 0x3fff * 0x3fff;

interface Entry {
  data: Buffer;
  width: number;
  height: number;
  bitsPerPixel: number;
}

function readEntries(data: Buffer): Entry[] {
  if (data.length < DIRECTORY_SIZE) throw new Error('Not an icon');
  const type = data.readUInt16LE(2);
  const count = data.readUInt16LE(4);
  if (
    data.readUInt16LE(0) !== 0 ||
    (type !== TYPE_ICON && type !== TYPE_CURSOR)
  ) {
    throw new Error('Not an icon');
  }
  if (count === 0) throw new Error('Icon without images');
  if (DIRECTORY_SIZE + count * ENTRY_SIZE > data.length) {
    throw new Error('Truncated icon');
  }

  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const at = DIRECTORY_SIZE + i * ENTRY_SIZE;
    const size = data.readUInt32LE(at + 8);
    const offset = data.readUInt32LE(at + 12);
    if (offset + size > data.length || size < 8) {
      throw new Error('Truncated icon image');
    }
    const image = data.subarray(offset, offset + size);

    // The sizes in the directory are often wrong, the image itself says
    if (image.subarray(0, 8).equals(PNG_SIGNATURE)) {
      if (image.length < 24) throw new Error('Truncated icon image');
      entries.push({
        data: image,
        width: image.readUInt32BE(16),
        height: image.readUInt32BE(20),
        bitsPerPixel: 32,
      });
    } else {
      if (image.length < 40) throw new Error('Truncated icon image');
      entries.push({
        data: image,
        width: image.readInt32LE(4),
        // Twice the height, for the color and the transparency mask
        height: image.readInt32LE(8) / 2,
        bitsPerPixel: image.readUInt16LE(14),
      });
    }
  }
  return entries;
}

// Whether it is an icon or cursor with images where its directory says. Only
// four bytes identify them, which other files can start with too, like TGA
// images.
export function IsICO(data: Buffer): boolean {
  try {
    readEntries(data);
    return true;
  } catch {
    return false;
  }
}

// The largest image in the icon, and of those the one with the most colors
export function ICOdecode(data: Buffer): ICOImage {
  const entries = readEntries(data);
  const best = entries.reduce((a, b) =>
    b.width * b.height > a.width * a.height ||
    (b.width * b.height === a.width * a.height &&
      b.bitsPerPixel > a.bitsPerPixel)
      ? b
      : a,
  );
  if (best.data.subarray(0, 8).equals(PNG_SIGNATURE)) return { png: best.data };
  return { bitmap: decodeBitmap(best.data) };
}

// A bitmap without its file header, which is followed by a mask that says
// which pixels are transparent
function decodeBitmap(data: Buffer): ICOBitmap {
  const headerSize = data.readUInt32LE(0);
  const width = data.readInt32LE(4);
  const storedHeight = data.readInt32LE(8);
  const bitsPerPixel = data.readUInt16LE(14);
  const compression = data.readUInt32LE(16);
  const colorsUsed = data.readUInt32LE(32);

  if (headerSize < 40 || headerSize > data.length) {
    throw new Error('Unsupported icon image');
  }
  // Always stored bottom-up, with the mask making up the other half
  if (width <= 0 || storedHeight <= 0 || storedHeight % 2 !== 0) {
    throw new Error('Invalid icon image size');
  }
  const height = storedHeight / 2;
  if (width * height > ICO_MAX_PIXELS) throw new Error('Icon image too large');
  if (![1, 4, 8, 24, 32].includes(bitsPerPixel) || compression !== BI_RGB) {
    throw new Error(`Unsupported icon image with ${bitsPerPixel} bits`);
  }

  // The palette, as BGRX
  const paletteSize = bitsPerPixel <= 8 ? colorsUsed || 1 << bitsPerPixel : 0;
  if (paletteSize > 1 << bitsPerPixel && bitsPerPixel <= 8) {
    throw new Error('Invalid icon palette');
  }
  const paletteOffset = headerSize;
  const colorOffset = paletteOffset + paletteSize * 4;
  const colorStride = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const maskOffset = colorOffset + colorStride * height;
  const maskStride = Math.floor((width + 31) / 32) * 4;
  if (maskOffset > data.length) throw new Error('Truncated icon image');
  // Some 32 bit icons leave the mask out, their alpha is enough
  const hasMask = maskOffset + maskStride * height <= data.length;

  const pixels = Buffer.alloc(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = colorOffset + (height - 1 - y) * colorStride;
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      if (bitsPerPixel <= 8) {
        const bit = x * bitsPerPixel;
        const byte = data[row + (bit >> 3)];
        const index =
          (byte >> (8 - bitsPerPixel - (bit & 7))) & ((1 << bitsPerPixel) - 1);
        if (index >= paletteSize) throw new Error('Icon color out of range');
        const color = paletteOffset + index * 4;
        pixels[out] = data[color + 2];
        pixels[out + 1] = data[color + 1];
        pixels[out + 2] = data[color];
        pixels[out + 3] = 255;
      } else {
        const at = row + x * (bitsPerPixel / 8);
        pixels[out] = data[at + 2];
        pixels[out + 1] = data[at + 1];
        pixels[out + 2] = data[at];
        pixels[out + 3] = bitsPerPixel === 32 ? data[at + 3] : 255;
        if (bitsPerPixel === 32 && data[at + 3] !== 0) anyAlpha = true;
      }
    }
  }

  // The mask says which pixels are transparent, unless 32 bit pixels say so
  // themselves
  if (hasMask && !anyAlpha) {
    for (let y = 0; y < height; y++) {
      const row = maskOffset + (height - 1 - y) * maskStride;
      for (let x = 0; x < width; x++) {
        const transparent = (data[row + (x >> 3)] >> (7 - (x & 7))) & 1;
        pixels[(y * width + x) * 4 + 3] = transparent ? 0 : 255;
      }
    }
  } else if (!hasMask && bitsPerPixel !== 32) {
    throw new Error('Truncated icon image');
  }

  return { pixels, width, height, channels: 4 };
}

// Writes an icon of PNG images, each at most 256 pixels wide and high
export function ICOencode(
  images: { png: Buffer; width: number; height: number }[],
): Buffer {
  const directory = Buffer.alloc(DIRECTORY_SIZE + images.length * ENTRY_SIZE);
  directory.writeUInt16LE(TYPE_ICON, 2);
  directory.writeUInt16LE(images.length, 4);

  let offset = directory.length;
  images.forEach((image, i) => {
    if (image.width > 256 || image.height > 256) {
      throw new Error('Icon images are at most 256 pixels wide and high');
    }
    const at = DIRECTORY_SIZE + i * ENTRY_SIZE;
    // 0 stands for 256
    directory[at] = image.width & 0xff;
    directory[at + 1] = image.height & 0xff;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(image.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.png.length;
  });

  return Buffer.concat([directory, ...images.map((image) => image.png)]);
}
