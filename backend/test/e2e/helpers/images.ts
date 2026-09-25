import { readFileSync } from 'node:fs';
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
