import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';

// Test images are generated on the fly where possible, instead of being kept
// in the repository.

export async function makePng(width = 64, height = 48): Promise<Buffer> {
  // A gradient-ish image with some transparency, so conversions have
  // something to work with
  const channels = 4;
  const pixels = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      pixels[i] = (x * 255) / width;
      pixels[i + 1] = (y * 255) / height;
      pixels[i + 2] = 128;
      pixels[i + 3] = x < width / 2 ? 255 : 128;
    }
  }
  return sharp(pixels, { raw: { width, height, channels } }).png().toBuffer();
}

export async function makeJpeg(width = 64, height = 48): Promise<Buffer> {
  return sharp(await makePng(width, height))
    .flatten({ background: '#ffffff' })
    .jpeg()
    .toBuffer();
}

export async function convertTo(
  image: Buffer,
  format: 'webp' | 'gif' | 'tiff' | 'avif',
): Promise<Buffer> {
  return sharp(image).toFormat(format).toBuffer();
}

// An animated gif where every frame has its own solid colour.
//
// Sharp can not create animations from scratch, so this writes the GIF by
// hand. With a 128 colour palette every LZW code is exactly one byte, and by
// emitting a clear code every 126 pixels the code table never grows, so the
// pixels can be written without any actual compression.
export function makeAnimatedGif(frames = 3, width = 32, height = 32): Buffer {
  const palette = [
    [0, 0, 0],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [0, 255, 255],
    [255, 0, 255],
    [255, 255, 255],
  ];
  const clearCode = 128;
  const endCode = 129;

  const bytes: number[] = [];
  const u16 = (v: number) => bytes.push(v & 0xff, (v >> 8) & 0xff);

  bytes.push(...Buffer.from('GIF89a'));
  // Logical screen with a 128 entry global colour table
  u16(width);
  u16(height);
  bytes.push(0xf6, 0, 0);
  for (let i = 0; i < 128; i++) bytes.push(...(palette[i] ?? [0, 0, 0]));
  // Loop forever
  bytes.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'));
  bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);

  for (let f = 0; f < frames; f++) {
    // Graphic control extension: 100ms delay
    bytes.push(0x21, 0xf9, 0x04, 0x04);
    u16(10);
    bytes.push(0x00, 0x00);
    // Image descriptor covering the whole screen
    bytes.push(0x2c);
    u16(0);
    u16(0);
    u16(width);
    u16(height);
    bytes.push(0x00);

    // LZW minimum code size, then the codes in sub-blocks of 255 bytes
    bytes.push(7);
    const colour = (f % (palette.length - 1)) + 1;
    const codes = [clearCode];
    for (let p = 0; p < width * height; p++) {
      if (p > 0 && p % 126 === 0) codes.push(clearCode);
      codes.push(colour);
    }
    codes.push(endCode);
    for (let i = 0; i < codes.length; i += 255) {
      const block = codes.slice(i, i + 255);
      bytes.push(block.length, ...block);
    }
    bytes.push(0x00);
  }

  bytes.push(0x3b);
  return Buffer.from(bytes);
}

// An animated WebP with frames of red, green and blue, each with a black
// corner at the top left, so it can be seen how they are turned
export async function makeAnimatedWebp(
  width = 40,
  height = 20,
): Promise<Buffer> {
  const colours = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ];
  const frames = colours.map((colour) => {
    const frame = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        frame.set(x < 4 && y < 4 ? [0, 0, 0] : colour, (y * width + x) * 3);
      }
    }
    return frame;
  });
  return sharp(Buffer.concat(frames), {
    animated: true,
    raw: {
      width,
      height: height * frames.length,
      channels: 3,
      pageHeight: height,
    },
  })
    .webp({ lossless: true, delay: [100, 200, 300], loop: 0 })
    .toBuffer();
}

// EXIF data that only has an orientation
function orientationExif(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  return tiff;
}

// Says the WebP image is to be turned, which sharp can not write for
// animations
export function withWebpOrientation(webp: Buffer, orientation: number) {
  if (webp.toString('latin1', 12, 16) !== 'VP8X') {
    throw new Error('Only extended WebP images can have EXIF data');
  }
  const exif = orientationExif(orientation);
  const chunk = Buffer.alloc(8 + exif.length);
  chunk.write('EXIF', 0, 'latin1');
  chunk.writeUInt32LE(exif.length, 4);
  exif.copy(chunk, 8);

  const result = Buffer.concat([webp, chunk]);
  result.writeUInt32LE(result.length - 8, 4);
  // The flag that says there is EXIF data
  result[20] |= 0x08;
  return result;
}

// Says the PNG image is to be turned, with an eXIf chunk after its header
export function withPngOrientation(png: Buffer, orientation: number) {
  const exif = orientationExif(orientation);
  const chunk = Buffer.alloc(12 + exif.length);
  chunk.writeUInt32BE(exif.length, 0);
  chunk.write('eXIf', 4, 'latin1');
  exif.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(chunk.subarray(4, 8 + exif.length)),
    8 + exif.length,
  );
  // The signature and the header chunk come first
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

export async function metadata(image: Buffer) {
  return sharp(image, { animated: true }).metadata();
}

// A 64x48 HEIC compressed with HEVC, the format phones take photos in. Sharp's
// own builds can neither write nor read these, so this one is kept in the
// repository. It was made with pillow-heif 1.8.0 (libheif 1.23.4 and x265),
// from an RGB image where the pixel at (x, y) is (x * 4, y * 5, 128), saved
// with quality 90.
export function makeHevcHeic(): Buffer {
  return readFileSync(new URL('../fixtures/hevc.heic', import.meta.url));
}
