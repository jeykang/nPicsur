// Encoder and decoder for Truevision TGA images, following the TGA 2.0
// specification. libvips can only read these through ImageMagick, which is not
// something to expose to uploaded files, so Picsur handles them itself.
//
// Supported for decoding: color-mapped, true color and greyscale images, run
// length encoded or not, with 8, 15, 16, 24 and 32 bits per pixel, in any of
// the four orientations. Written as uncompressed 24 or 32 bit images.

export interface TGAImage {
  pixels: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
}

const HEADER_SIZE = 18;
const FOOTER_SIZE = 26;
const SIGNATURE = 'TRUEVISION-XFILE.\0';

const TYPE_COLOR_MAPPED = 1;
const TYPE_TRUE_COLOR = 2;
const TYPE_GREYSCALE = 3;
const RLE = 8;

const DESCRIPTOR_ALPHA_BITS = 0x0f;
const DESCRIPTOR_RIGHT_TO_LEFT = 0x10;
const DESCRIPTOR_TOP_TO_BOTTOM = 0x20;

// Refuse to decode images larger than this, to not be tricked into allocating
// huge buffers by a tiny file with a made up header. Same as sharp's default
// limit for other formats.
export const TGA_MAX_PIXELS = 0x3fff * 0x3fff;

interface Header {
  idLength: number;
  hasColorMap: boolean;
  type: number;
  rle: boolean;
  colorMapStart: number;
  colorMapLength: number;
  colorMapDepth: number;
  width: number;
  height: number;
  depth: number;
  alphaBits: number;
  rightToLeft: boolean;
  topToBottom: boolean;
}

// Reads the header, or returns null when it is not one of a TGA image Picsur
// can decode
function readHeader(data: Buffer): Header | null {
  if (data.length < HEADER_SIZE) return null;

  const colorMapType = data[1];
  const imageType = data[2];
  const type = imageType & ~RLE;
  const header: Header = {
    idLength: data[0],
    hasColorMap: colorMapType === 1,
    type,
    rle: (imageType & RLE) !== 0,
    colorMapStart: data.readUInt16LE(3),
    colorMapLength: data.readUInt16LE(5),
    colorMapDepth: data[7],
    width: data.readUInt16LE(12),
    height: data.readUInt16LE(14),
    depth: data[16],
    alphaBits: data[17] & DESCRIPTOR_ALPHA_BITS,
    rightToLeft: (data[17] & DESCRIPTOR_RIGHT_TO_LEFT) !== 0,
    topToBottom: (data[17] & DESCRIPTOR_TOP_TO_BOTTOM) !== 0,
  };

  // Interleaving was never used, and nothing else is allowed there
  if ((data[17] & 0xc0) !== 0) return null;
  if (colorMapType !== 0 && colorMapType !== 1) return null;
  if (![1, 2, 3, 9, 10, 11].includes(imageType)) return null;
  if (header.width === 0 || header.height === 0) return null;

  if (type === TYPE_COLOR_MAPPED) {
    if (!header.hasColorMap || header.depth !== 8) return null;
    if (![15, 16, 24, 32].includes(header.colorMapDepth)) return null;
    if (header.colorMapLength === 0) return null;
  } else if (type === TYPE_TRUE_COLOR) {
    if (![15, 16, 24, 32].includes(header.depth)) return null;
  } else if (type === TYPE_GREYSCALE) {
    if (header.depth !== 8 && header.depth !== 16) return null;
  }
  // A color map that is not used can still be there, then it is skipped
  if (header.hasColorMap && ![15, 16, 24, 32].includes(header.colorMapDepth)) {
    return null;
  }
  return header;
}

function colorMapSize(header: Header): number {
  return header.hasColorMap
    ? header.colorMapLength * Math.ceil(header.colorMapDepth / 8)
    : 0;
}

// TGA files have no signature at the start, newer ones have one at the end.
// Older ones can only be recognised by a header that makes sense, and by
// being large enough for what it describes.
export function IsTGA(data: Buffer): boolean {
  const header = readHeader(data);
  if (header === null) return false;

  if (
    data.length >= HEADER_SIZE + FOOTER_SIZE &&
    data.toString('latin1', data.length - SIGNATURE.length) === SIGNATURE
  ) {
    return true;
  }

  const pixelData = HEADER_SIZE + header.idLength + colorMapSize(header);
  const bytesPerPixel = Math.ceil(header.depth / 8);
  const minimum = header.rle
    ? // One packet of at most 128 pixels, of one pixel each
      pixelData +
      Math.ceil((header.width * header.height) / 128) * (1 + bytesPerPixel)
    : pixelData + header.width * header.height * bytesPerPixel;
  return data.length >= minimum;
}

// 5 bits to 8, by repeating the highest bits, so 0 stays 0 and 31 becomes 255
function expand5(value: number): number {
  return (value << 3) | (value >> 2);
}

// Reads a pixel of 15, 16, 24 or 32 bits as RGBA
function readColor(
  data: Buffer,
  offset: number,
  depth: number,
  out: Uint8Array,
): void {
  if (depth === 15 || depth === 16) {
    const value = data.readUInt16LE(offset);
    out[0] = expand5((value >> 10) & 0x1f);
    out[1] = expand5((value >> 5) & 0x1f);
    out[2] = expand5(value & 0x1f);
    out[3] = value & 0x8000 ? 255 : 0;
  } else {
    if (offset + (depth >> 3) > data.length) throw new RangeError('Truncated');
    out[0] = data[offset + 2];
    out[1] = data[offset + 1];
    out[2] = data[offset];
    out[3] = depth === 32 ? data[offset + 3] : 255;
  }
}

export function TGAdecode(data: Buffer): TGAImage {
  const header = readHeader(data);
  if (header === null) throw new Error('Not a supported TGA image');
  const { width, height, depth } = header;
  if (width * height > TGA_MAX_PIXELS) {
    throw new Error(`TGA image is too large: ${width}x${height}`);
  }

  let offset = HEADER_SIZE + header.idLength;

  // The color map, as RGBA
  let colorMap: Uint8Array | null = null;
  if (header.hasColorMap) {
    const entrySize = Math.ceil(header.colorMapDepth / 8);
    const end = offset + header.colorMapLength * entrySize;
    if (end > data.length) throw new Error('Truncated TGA color map');
    if (header.type === TYPE_COLOR_MAPPED) {
      colorMap = new Uint8Array(header.colorMapLength * 4);
      const color = new Uint8Array(4);
      for (let i = 0; i < header.colorMapLength; i++) {
        readColor(data, offset + i * entrySize, header.colorMapDepth, color);
        colorMap.set(color, i * 4);
      }
    }
    offset = end;
  }

  const bytesPerPixel = Math.ceil(depth / 8);
  const count = width * height;

  // The pixel values as they are stored, run length decoded when needed
  let raw: Buffer;
  if (header.rle) {
    raw = Buffer.alloc(count * bytesPerPixel);
    let written = 0;
    while (written < raw.length) {
      if (offset >= data.length) throw new Error('Truncated TGA image data');
      const packet = data[offset++];
      const pixels = (packet & 0x7f) + 1;
      const size = pixels * bytesPerPixel;
      // Packets may run past the end of a row, but not past the image
      if (written + size > raw.length) throw new Error('Invalid TGA run');
      if (packet & 0x80) {
        if (offset + bytesPerPixel > data.length) {
          throw new Error('Truncated TGA image data');
        }
        for (let i = 0; i < pixels; i++) {
          data.copy(raw, written, offset, offset + bytesPerPixel);
          written += bytesPerPixel;
        }
        offset += bytesPerPixel;
      } else {
        if (offset + size > data.length) {
          throw new Error('Truncated TGA image data');
        }
        data.copy(raw, written, offset, offset + size);
        written += size;
        offset += size;
      }
    }
  } else {
    if (offset + count * bytesPerPixel > data.length) {
      throw new Error('Truncated TGA image data');
    }
    raw = data.subarray(offset, offset + count * bytesPerPixel);
  }

  // Decode to RGBA in storage order
  const rgba = Buffer.alloc(count * 4);
  const color = new Uint8Array(4);
  for (let i = 0; i < count; i++) {
    const at = i * bytesPerPixel;
    if (header.type === TYPE_COLOR_MAPPED) {
      const index = raw[at] - header.colorMapStart;
      if (colorMap === null || index < 0 || index * 4 >= colorMap.length) {
        throw new Error('TGA color index out of range');
      }
      color.set(colorMap.subarray(index * 4, index * 4 + 4));
    } else if (header.type === TYPE_GREYSCALE) {
      color[0] = color[1] = color[2] = raw[at];
      color[3] = depth === 16 ? raw[at + 1] : 255;
    } else {
      readColor(raw, at, depth, color);
    }
    rgba.set(color, i * 4);
  }

  // Alpha only counts when the header says so, or for 32 bits when it is not
  // left all zeroes, which many writers do even though it says there is none
  const alphaDepth =
    header.type === TYPE_COLOR_MAPPED ? header.colorMapDepth : depth;
  let hasAlpha =
    alphaDepth === 32 ||
    (header.type === TYPE_GREYSCALE && depth === 16) ||
    ((alphaDepth === 15 || alphaDepth === 16) && header.alphaBits > 0);
  if (hasAlpha) {
    let any = false;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] !== 0) {
        any = true;
        break;
      }
    }
    if (!any) hasAlpha = false;
  }

  // Put it in the usual order, left to right and top to bottom
  const channels = hasAlpha ? 4 : 3;
  const pixels = Buffer.alloc(count * channels);
  for (let y = 0; y < height; y++) {
    const sourceRow = header.topToBottom ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const sourceColumn = header.rightToLeft ? width - 1 - x : x;
      const from = (sourceRow * width + sourceColumn) * 4;
      const to = (y * width + x) * channels;
      pixels[to] = rgba[from];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from + 2];
      if (hasAlpha) pixels[to + 3] = rgba[from + 3];
    }
  }

  return { pixels, width, height, channels };
}

// Writes an uncompressed true color image, top to bottom, with the footer of
// TGA 2.0 files so it can be recognised again
export function TGAencode(
  pixels: Buffer,
  options: { width: number; height: number; channels: 3 | 4 },
): Buffer {
  const { width, height, channels } = options;
  if (channels !== 3 && channels !== 4) {
    throw new Error('TGA only supports 3 or 4 channels');
  }
  if (width > 0xffff || height > 0xffff) {
    throw new Error(`Too large for TGA: ${width}x${height}`);
  }
  if (pixels.length !== width * height * channels) {
    throw new Error('Pixel data does not match the dimensions');
  }

  const header = Buffer.alloc(HEADER_SIZE);
  header[2] = TYPE_TRUE_COLOR;
  header.writeUInt16LE(width, 12);
  header.writeUInt16LE(height, 14);
  header[16] = channels * 8;
  header[17] = DESCRIPTOR_TOP_TO_BOTTOM | (channels === 4 ? 8 : 0);

  // Stored as BGR(A)
  const data = Buffer.alloc(pixels.length);
  for (let i = 0; i < pixels.length; i += channels) {
    data[i] = pixels[i + 2];
    data[i + 1] = pixels[i + 1];
    data[i + 2] = pixels[i];
    if (channels === 4) data[i + 3] = pixels[i + 3];
  }

  // No extension or developer area
  const footer = Buffer.alloc(FOOTER_SIZE);
  footer.write(SIGNATURE, 8, 'latin1');

  return Buffer.concat([header, data, footer]);
}
