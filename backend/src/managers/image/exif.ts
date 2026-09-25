// Reads the orientation from EXIF data, which starts with a TIFF header, as
// in JPEG and WebP files and the eXIf chunk of PNG files. Returns undefined
// when there is none, or the data is not what it should be, which is also how
// browsers and libvips treat it.
export function ExifOrientation(tiff: Buffer): number | undefined {
  try {
    const order = tiff.toString('latin1', 0, 2);
    if (order !== 'II' && order !== 'MM') return undefined;
    const le = order === 'II';
    const u16 = (at: number) =>
      le ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at);
    const u32 = (at: number) =>
      le ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at);

    if (u16(2) !== 42) return undefined;
    const ifd = u32(4);
    const entries = u16(ifd);
    for (let i = 0; i < entries; i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) !== 0x0112) continue;
      // Orientation is a single SHORT
      if (u16(entry + 2) !== 3) return undefined;
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// The smallest EXIF data that says how an image is oriented, and nothing else
export function OrientationOnlyExif(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  // The one directory starts right after the header
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  // Orientation, a SHORT, one of them
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  // No next directory
  tiff.writeUInt32BE(0, 22);
  return tiff;
}

// Orientations 5 to 8 turn the image a quarter, so width and height swap
export function OrientationSwapsSides(orientation: number | undefined) {
  return orientation !== undefined && orientation >= 5 && orientation <= 8;
}
