import { IsQOI } from '../../workers/codecs/qoi.js';

export interface Dimensions {
  width: number;
  height: number;
}

// Reads the dimensions of a stored master image from its header, without
// decoding it. Masters are always QOI (still images) or WebP (animations).
// Returns null for anything else.
export function MasterDimensions(data: Buffer): Dimensions | null {
  if (IsQOI(data)) {
    return { width: data.readUInt32BE(4), height: data.readUInt32BE(8) };
  }
  return WebPDimensions(data);
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
