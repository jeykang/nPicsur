import { IsQOI } from '../../workers/codecs/qoi.js';
import { ExifOrientation, OrientationSwapsSides } from './exif.js';

export interface Dimensions {
  width: number;
  height: number;
}

// Reads the dimensions of a stored master image from its header, without
// decoding it, as it is shown. Masters are QOI, or uploads kept as they are:
// JPEG, PNG, WebP or GIF. Returns null for anything else.
export function MasterDimensions(data: Buffer): Dimensions | null {
  try {
    if (IsQOI(data)) {
      return { width: data.readUInt32BE(4), height: data.readUInt32BE(8) };
    }
    return (
      WebPDimensions(data) ??
      PngDimensions(data) ??
      GifDimensions(data) ??
      JpegDimensions(data)
    );
  } catch {
    return null;
  }
}

function PngDimensions(data: Buffer): Dimensions | null {
  if (
    data.readUInt32BE(0) !== 0x89504e47 ||
    data.toString('latin1', 12, 16) !== 'IHDR'
  ) {
    return null;
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function GifDimensions(data: Buffer): Dimensions | null {
  if (data.toString('latin1', 0, 3) !== 'GIF') return null;
  return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
}

// The size in the frame header, turned when the EXIF orientation says so
function JpegDimensions(data: Buffer): Dimensions | null {
  if (data.readUInt16BE(0) !== 0xffd8) return null;

  let orientation: number | undefined;
  let offset = 2;
  for (;;) {
    if (data[offset] !== 0xff) return null;
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    const length = data.readUInt16BE(offset);
    const payload = data.subarray(offset + 2, offset + length);

    if (marker === 0xe1 && payload.toString('latin1', 0, 6) === 'Exif\0\0') {
      orientation = ExifOrientation(payload.subarray(6));
    } else if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      const height = payload.readUInt16BE(1);
      const width = payload.readUInt16BE(3);
      return OrientationSwapsSides(orientation)
        ? { width: height, height: width }
        : { width, height };
    } else if (marker === 0xda || marker === 0xd9) {
      return null;
    }
    offset += length;
  }
}

// See RFC 9649 for the layout of the different WebP headers
function WebPDimensions(data: Buffer): Dimensions | null {
  if (
    data.length < 30 ||
    data.toString('latin1', 0, 4) !== 'RIFF' ||
    data.toString('latin1', 8, 12) !== 'WEBP'
  ) {
    return null;
  }

  switch (data.toString('latin1', 12, 16)) {
    case 'VP8X':
      // Canvas size minus one, as 24 bit numbers
      return {
        width: data.readUIntLE(24, 3) + 1,
        height: data.readUIntLE(27, 3) + 1,
      };
    case 'VP8L': {
      if (data[20] !== 0x2f) return null;
      const bits = data.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    case 'VP8 ':
      return {
        width: data.readUInt16LE(26) & 0x3fff,
        height: data.readUInt16LE(28) & 0x3fff,
      };
    default:
      return null;
  }
}
