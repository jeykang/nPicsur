// Encoder and decoder for Windows bitmaps. libvips can only read these through
// ImageMagick, which is not something to expose to uploaded files, so Picsur
// handles them itself. This replaces a native addon that stopped compiling on
// newer Node versions, and which could read past the end of its input.
//
// Supported for decoding: the core (OS/2 1.x), info, V2, V3, V4 and V5 headers,
// 1, 2, 4 and 8 bit palette images, 16, 24 and 32 bit images with or without
// bitfields (including alpha), top-down and bottom-up. Compressed images (RLE,
// or embedded JPEG/PNG) are refused.

export interface BMPImage {
  pixels: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
}

const FILE_HEADER_SIZE = 14;
const CORE_HEADER_SIZE = 12;
const INFO_HEADER_SIZE = 40;
const V4_HEADER_SIZE = 108;
const SUPPORTED_HEADER_SIZES = [12, 40, 52, 56, 108, 124];

const BI_RGB = 0;
const BI_BITFIELDS = 3;
const BI_ALPHABITFIELDS = 6;

const LCS_SRGB = 0x73524742; // "sRGB"

// Refuse to decode images larger than this, to not be tricked into allocating
// huge buffers by a tiny file with a made up header. Same as sharp's default
// limit for other formats.
export const BMP_MAX_PIXELS = 0x3fff * 0x3fff;

export function IsBMP(data: Buffer): boolean {
  return (
    data.length >= FILE_HEADER_SIZE && data.toString('latin1', 0, 2) === 'BM'
  );
}

interface Mask {
  mask: number;
  shift: number;
  bits: number;
}

function parseMask(mask: number): Mask {
  mask = mask >>> 0;
  if (mask === 0) return { mask: 0, shift: 0, bits: 0 };
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  let bits = 0;
  while (shift + bits < 32 && ((mask >>> (shift + bits)) & 1) === 1) bits++;
  return { mask, shift, bits };
}

// Scale a channel value of any bit depth to 8 bits (truncating, like the
// previous native decoder and most other decoders)
function scale(value: number, bits: number): number {
  if (bits === 8) return value;
  if (bits > 8) return value >>> (bits - 8);
  return Math.floor((value * 255) / ((1 << bits) - 1));
}

function extract(pixel: number, mask: Mask): number {
  return scale(((pixel & mask.mask) >>> mask.shift) >>> 0, mask.bits);
}

export function BMPdecode(data: Buffer): BMPImage {
  if (!IsBMP(data)) throw new Error('Not a BMP image');
  if (data.length < FILE_HEADER_SIZE + CORE_HEADER_SIZE) {
    throw new Error('BMP image is too small');
  }

  const dataOffset = data.readUInt32LE(10);
  const headerSize = data.readUInt32LE(14);
  if (!SUPPORTED_HEADER_SIZES.includes(headerSize)) {
    throw new Error(`Unsupported BMP header size ${headerSize}`);
  }
  if (data.length < FILE_HEADER_SIZE + headerSize) {
    throw new Error('BMP image is too small');
  }

  let width: number;
  let height: number;
  let planes: number;
  let bitsPerPixel: number;
  let compression = BI_RGB;
  let colorsUsed = 0;
  let paletteEntrySize = 4;
  let masksEnd = FILE_HEADER_SIZE + headerSize;
  let redMask = 0,
    greenMask = 0,
    blueMask = 0,
    alphaMask = 0;

  if (headerSize === CORE_HEADER_SIZE) {
    width = data.readUInt16LE(18);
    height = data.readUInt16LE(20);
    planes = data.readUInt16LE(22);
    bitsPerPixel = data.readUInt16LE(24);
    paletteEntrySize = 3;
  } else {
    width = data.readInt32LE(18);
    height = data.readInt32LE(22);
    planes = data.readUInt16LE(26);
    bitsPerPixel = data.readUInt16LE(28);
    compression = data.readUInt32LE(30);
    colorsUsed = data.readUInt32LE(46);

    if (compression === BI_BITFIELDS || compression === BI_ALPHABITFIELDS) {
      // Newer headers contain the masks, with the plain info header they
      // follow directly after it
      const maskCount =
        headerSize > INFO_HEADER_SIZE
          ? headerSize >= 56
            ? 4
            : 3
          : compression === BI_ALPHABITFIELDS
            ? 4
            : 3;
      if (headerSize === INFO_HEADER_SIZE) masksEnd += maskCount * 4;
      if (data.length < masksEnd) throw new Error('BMP image is too small');
      redMask = data.readUInt32LE(54);
      greenMask = data.readUInt32LE(58);
      blueMask = data.readUInt32LE(62);
      if (maskCount === 4) alphaMask = data.readUInt32LE(66);
    } else if (compression !== BI_RGB) {
      throw new Error('Compressed BMP images are not supported');
    }
  }

  const topDown = height < 0;
  height = Math.abs(height);

  if (planes !== 1) throw new Error('Invalid BMP planes');
  if (width <= 0 || height <= 0 || width * height > BMP_MAX_PIXELS) {
    throw new Error('Invalid BMP dimensions');
  }

  const stride = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  if (dataOffset + stride * height > data.length) {
    throw new Error('BMP image data is truncated');
  }

  const rowStart = (y: number) =>
    dataOffset + (topDown ? y : height - 1 - y) * stride;

  // Palette images
  if ([1, 2, 4, 8].includes(bitsPerPixel)) {
    const maxColors = 1 << bitsPerPixel;
    const paletteStart = masksEnd;
    if (paletteStart > dataOffset) throw new Error('Invalid BMP data offset');
    // Some writers leave out unused palette entries, those are read as black
    const paletteSize = Math.min(
      colorsUsed || maxColors,
      maxColors,
      Math.floor((dataOffset - paletteStart) / paletteEntrySize),
    );

    const palette = new Uint8Array(maxColors * 3);
    for (let i = 0; i < paletteSize; i++) {
      const entry = paletteStart + i * paletteEntrySize;
      palette[i * 3] = data[entry + 2];
      palette[i * 3 + 1] = data[entry + 1];
      palette[i * 3 + 2] = data[entry];
    }

    const pixels = Buffer.alloc(width * height * 3);
    const pixelsPerByte = 8 / bitsPerPixel;
    const indexMask = maxColors - 1;
    let o = 0;
    for (let y = 0; y < height; y++) {
      const row = rowStart(y);
      for (let x = 0; x < width; x++) {
        const byte = data[row + Math.floor(x / pixelsPerByte)];
        const shift = 8 - ((x % pixelsPerByte) + 1) * bitsPerPixel;
        const index = ((byte >> shift) & indexMask) * 3;
        pixels[o++] = palette[index];
        pixels[o++] = palette[index + 1];
        pixels[o++] = palette[index + 2];
      }
    }
    return { pixels, width, height, channels: 3 };
  }

  if (![16, 24, 32].includes(bitsPerPixel)) {
    throw new Error(`Unsupported BMP bit depth ${bitsPerPixel}`);
  }
  if (bitsPerPixel === 24 && compression !== BI_RGB) {
    throw new Error('Invalid BMP compression for 24 bit images');
  }

  // Without bitfields, 16 bit images are RGB555 and 32 bit images are BGRX
  if (compression === BI_RGB) {
    if (bitsPerPixel === 16) {
      redMask = 0x7c00;
      greenMask = 0x03e0;
      blueMask = 0x001f;
    } else {
      redMask = 0x00ff0000;
      greenMask = 0x0000ff00;
      blueMask = 0x000000ff;
    }
    alphaMask = 0;
  }

  const red = parseMask(redMask);
  const green = parseMask(greenMask);
  const blue = parseMask(blueMask);
  const alpha = parseMask(alphaMask);
  const channels = alpha.bits > 0 ? 4 : 3;
  const bytesPerPixel = bitsPerPixel / 8;

  const pixels = Buffer.alloc(width * height * channels);
  let o = 0;
  for (let y = 0; y < height; y++) {
    const row = rowStart(y);
    for (let x = 0; x < width; x++) {
      const p = row + x * bytesPerPixel;
      const value =
        bytesPerPixel === 2
          ? data.readUInt16LE(p)
          : bytesPerPixel === 3
            ? data[p] | (data[p + 1] << 8) | (data[p + 2] << 16)
            : data.readUInt32LE(p);
      pixels[o++] = extract(value, red);
      pixels[o++] = extract(value, green);
      pixels[o++] = extract(value, blue);
      if (channels === 4) pixels[o++] = extract(value, alpha);
    }
  }

  return { pixels, width, height, channels };
}

// Writes a bottom-up bitmap with a V4 header: 24 bit for RGB, 32 bit with an
// alpha bitfield for RGBA
export function BMPencode(
  pixels: Buffer,
  options: { width: number; height: number; channels: 3 | 4 },
): Buffer {
  const { width, height, channels } = options;
  if (channels !== 3 && channels !== 4) {
    throw new Error('BMP only supports 3 or 4 channels');
  }
  if (width <= 0 || height <= 0 || width * height > BMP_MAX_PIXELS) {
    throw new Error('Invalid BMP dimensions');
  }
  if (pixels.length !== width * height * channels) {
    throw new Error('Pixel data does not match the given dimensions');
  }

  const bitsPerPixel = channels * 8;
  const stride = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const dataOffset = FILE_HEADER_SIZE + V4_HEADER_SIZE;
  const dataSize = stride * height;
  const out = Buffer.alloc(dataOffset + dataSize);

  // File header
  out.write('BM', 0, 'latin1');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(dataOffset, 10);

  // V4 header
  out.writeUInt32LE(V4_HEADER_SIZE, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(bitsPerPixel, 28);
  out.writeUInt32LE(channels === 4 ? BI_BITFIELDS : BI_RGB, 30);
  out.writeUInt32LE(dataSize, 34);
  out.writeInt32LE(2835, 38); // 72 dpi
  out.writeInt32LE(2835, 42);
  if (channels === 4) {
    out.writeUInt32LE(0x00ff0000, 54);
    out.writeUInt32LE(0x0000ff00, 58);
    out.writeUInt32LE(0x000000ff, 62);
    out.writeUInt32LE(0xff000000, 66);
  }
  out.writeUInt32LE(LCS_SRGB, 70);

  const rowLength = width * channels;
  for (let y = 0; y < height; y++) {
    const source = (height - 1 - y) * rowLength;
    let target = dataOffset + y * stride;
    for (let x = 0; x < rowLength; x += channels) {
      out[target++] = pixels[source + x + 2];
      out[target++] = pixels[source + x + 1];
      out[target++] = pixels[source + x];
      if (channels === 4) out[target++] = pixels[source + x + 3];
    }
  }

  return out;
}
