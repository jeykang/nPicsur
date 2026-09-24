import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BMPdecode, BMPencode, IsBMP } from '../../src/workers/codecs/bmp.js';
import { IsQOI, QOIdecode, QOIencode } from '../../src/workers/codecs/qoi.js';

// Images with runs, gradients and repeated colours, so every QOI operation
// gets used
function testImage(width: number, height: number, channels: 3 | 4) {
  const pixels = Buffer.alloc(width * height * channels);
  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    const values = [x * 3, y % 3 === 0 ? 7 : x ^ y, x < width / 2 ? 50 : 51];
    values.push(y % 2 === 0 ? 255 : x * 5);
    for (let c = 0; c < channels; c++) {
      pixels[i * channels + c] = values[c] & 0xff;
    }
  }
  return pixels;
}

describe('QOI', () => {
  it.each([
    [1, 1, 3],
    [1, 1, 4],
    [7, 3, 3],
    [64, 64, 4],
    [200, 31, 3],
  ] as const)('round trips a %dx%d image with %d channels', (w, h, c) => {
    for (const pixels of [testImage(w, h, c), randomBytes(w * h * c)]) {
      const encoded = QOIencode(pixels, { width: w, height: h, channels: c });
      expect(IsQOI(encoded)).toBe(true);
      const decoded = QOIdecode(encoded);
      expect(decoded).toMatchObject({ width: w, height: h, channels: c });
      expect(decoded.pixels.equals(pixels)).toBe(true);
    }
  });

  it('writes a spec compliant header and end marker', () => {
    const encoded = QOIencode(Buffer.alloc(3 * 5 * 4), {
      width: 3,
      height: 5,
      channels: 4,
    });
    expect(encoded.subarray(0, 4).toString('latin1')).toBe('qoif');
    expect(encoded.readUInt32BE(4)).toBe(3);
    expect(encoded.readUInt32BE(8)).toBe(5);
    expect(encoded[12]).toBe(4);
    expect(encoded[13]).toBe(0);
    expect([...encoded.subarray(-8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('compresses runs', () => {
    const encoded = QOIencode(Buffer.alloc(1000 * 1000 * 3, 0x42), {
      width: 1000,
      height: 1000,
      channels: 3,
    });
    expect(encoded.length).toBeLessThan(20_000);
  });

  it('decodes a hand written image', () => {
    // 2x2: RGB(1,2,3), a run of 2, then an index back to the first colour
    // after a DIFF
    const bytes = Buffer.from([
      ...Buffer.from('qoif'),
      0,
      0,
      0,
      3,
      0,
      0,
      0,
      2,
      3,
      0,
      0xfe,
      1,
      2,
      3, // RGB 1,2,3
      0xc1, // run of 2
      0x40 | (3 << 4) | (2 << 2) | 1, // diff +1, 0, -1: 2,2,2
      0x80 | 32,
      (8 << 4) | 8, // luma, no change
      0x00 | ((1 * 3 + 2 * 5 + 3 * 7 + 255 * 11) % 64), // index: 1,2,3
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
    ]);
    const decoded = QOIdecode(bytes);
    expect([...decoded.pixels]).toEqual([
      1, 2, 3, 1, 2, 3, 1, 2, 3, 2, 2, 2, 2, 2, 2, 1, 2, 3,
    ]);
  });

  it('refuses invalid images', () => {
    expect(() => QOIdecode(Buffer.from('not a qoi image at all'))).toThrow();
    const header = Buffer.alloc(22);
    header.write('qoif', 0, 'latin1');
    header.writeUInt32BE(100_000, 4);
    header.writeUInt32BE(100_000, 8);
    header[12] = 4;
    // A tiny file claiming to be huge must not allocate 40GB
    expect(() => QOIdecode(header)).toThrow(/dimensions/);
    header.writeUInt32BE(1, 4);
    header.writeUInt32BE(1, 8);
    header[12] = 2;
    expect(() => QOIdecode(header)).toThrow(/channel/);
  });
});

// Builds a bitmap file by hand, to test variants the encoder never writes
function buildBMP(options: {
  width: number;
  height: number;
  bitsPerPixel: number;
  headerSize?: number;
  compression?: number;
  masks?: number[];
  palette?: [number, number, number][];
  rows: number[][]; // raw bytes per row, top row first
  topDown?: boolean;
}) {
  const headerSize = options.headerSize ?? 40;
  const stride =
    Math.floor((options.bitsPerPixel * options.width + 31) / 32) * 4;
  const masksAfterHeader =
    headerSize === 40 && options.masks ? options.masks.length * 4 : 0;
  const paletteEntry = headerSize === 12 ? 3 : 4;
  const paletteSize = (options.palette?.length ?? 0) * paletteEntry;
  const dataOffset = 14 + headerSize + masksAfterHeader + paletteSize;
  const file = Buffer.alloc(dataOffset + stride * options.height);

  file.write('BM', 0, 'latin1');
  file.writeUInt32LE(file.length, 2);
  file.writeUInt32LE(dataOffset, 10);
  file.writeUInt32LE(headerSize, 14);
  if (headerSize === 12) {
    file.writeUInt16LE(options.width, 18);
    file.writeUInt16LE(options.height, 20);
    file.writeUInt16LE(1, 22);
    file.writeUInt16LE(options.bitsPerPixel, 24);
  } else {
    file.writeInt32LE(options.width, 18);
    file.writeInt32LE(options.topDown ? -options.height : options.height, 22);
    file.writeUInt16LE(1, 26);
    file.writeUInt16LE(options.bitsPerPixel, 28);
    file.writeUInt32LE(options.compression ?? 0, 30);
    file.writeUInt32LE(options.palette?.length ?? 0, 46);
    options.masks?.forEach((mask, i) =>
      file.writeUInt32LE(mask >>> 0, 54 + i * 4),
    );
  }
  options.palette?.forEach(([r, g, b], i) => {
    const at = 14 + headerSize + masksAfterHeader + i * paletteEntry;
    file[at] = b;
    file[at + 1] = g;
    file[at + 2] = r;
  });
  options.rows.forEach((row, y) => {
    const fileRow = options.topDown ? y : options.height - 1 - y;
    Buffer.from(row).copy(file, dataOffset + fileRow * stride);
  });
  return file;
}

describe('BMP', () => {
  it.each([
    [1, 1, 3],
    [1, 1, 4],
    [5, 3, 3],
    [33, 17, 4],
  ] as const)('round trips a %dx%d image with %d channels', (w, h, c) => {
    const pixels = randomBytes(w * h * c);
    const encoded = BMPencode(pixels, { width: w, height: h, channels: c });
    expect(IsBMP(encoded)).toBe(true);
    const decoded = BMPdecode(encoded);
    expect(decoded).toMatchObject({ width: w, height: h, channels: c });
    expect(decoded.pixels.equals(pixels)).toBe(true);
  });

  const red: [number, number, number] = [255, 0, 0];
  const green: [number, number, number] = [0, 255, 0];
  const blue: [number, number, number] = [0, 0, 255];
  const white: [number, number, number] = [255, 255, 255];

  it('decodes 1 bit palette images', () => {
    const bmp = buildBMP({
      width: 10,
      height: 2,
      bitsPerPixel: 1,
      palette: [red, blue],
      rows: [
        [0b10100000, 0b01000000],
        [0b11111111, 0b11000000],
      ],
    });
    const { pixels, channels } = BMPdecode(bmp);
    expect(channels).toBe(3);
    const colours = [];
    for (let i = 0; i < pixels.length; i += 3) {
      colours.push(pixels[i] === 255 ? 'r' : 'b');
    }
    expect(colours.join('')).toBe('brbrrrrrrb' + 'bbbbbbbbbb');
  });

  it('decodes 2 and 4 bit palette images', () => {
    const two = BMPdecode(
      buildBMP({
        width: 4,
        height: 1,
        bitsPerPixel: 2,
        palette: [red, green, blue, white],
        rows: [[0b00011011]],
      }),
    );
    expect([...two.pixels]).toEqual([...red, ...green, ...blue, ...white]);

    const four = BMPdecode(
      buildBMP({
        width: 3,
        height: 1,
        bitsPerPixel: 4,
        palette: [red, green, blue],
        rows: [[0x21, 0x00]],
      }),
    );
    expect([...four.pixels]).toEqual([...blue, ...green, ...red]);
  });

  it('decodes 8 bit palette images with an implicit palette size', () => {
    const palette = Array.from(
      { length: 256 },
      (_, i) => [i, 255 - i, 7] as [number, number, number],
    );
    const bmp = buildBMP({
      width: 2,
      height: 1,
      bitsPerPixel: 8,
      palette,
      rows: [[200, 3]],
    });
    // A colour count of 0 means all 256
    bmp.writeUInt32LE(0, 46);
    expect([...BMPdecode(bmp).pixels]).toEqual([200, 55, 7, 3, 252, 7]);
  });

  it('reads missing palette entries as black', () => {
    const bmp = buildBMP({
      width: 2,
      height: 1,
      bitsPerPixel: 8,
      palette: [red, green],
      rows: [[1, 5]],
    });
    expect([...BMPdecode(bmp).pixels]).toEqual([...green, 0, 0, 0]);
  });

  it('decodes 16 bit RGB555 and RGB565 images', () => {
    const rgb555 = BMPdecode(
      buildBMP({
        width: 2,
        height: 1,
        bitsPerPixel: 16,
        rows: [[0x00, 0x7c, 0x1f, 0x00]], // 0x7c00 = red, 0x001f = blue
      }),
    );
    expect([...rgb555.pixels]).toEqual([...red, ...blue]);

    const rgb565 = BMPdecode(
      buildBMP({
        width: 2,
        height: 1,
        bitsPerPixel: 16,
        compression: 3,
        masks: [0xf800, 0x07e0, 0x001f],
        rows: [[0xe0, 0x07, 0x00, 0x80]], // 0x07e0 = green, 0x8000 = mid red
      }),
    );
    expect([...rgb565.pixels]).toEqual([...green, 131, 0, 0]);
  });

  it('decodes 24 and 32 bit images, top-down and bottom-up', () => {
    for (const topDown of [false, true]) {
      const rgb = BMPdecode(
        buildBMP({
          width: 1,
          height: 2,
          bitsPerPixel: 24,
          topDown,
          rows: [
            [0, 0, 255],
            [255, 0, 0],
          ],
        }),
      );
      expect([...rgb.pixels]).toEqual([...red, ...blue]);
    }

    // 32 bit without bitfields: the fourth byte is not alpha
    const bgrx = BMPdecode(
      buildBMP({
        width: 1,
        height: 1,
        bitsPerPixel: 32,
        rows: [[1, 2, 3, 0]],
      }),
    );
    expect(bgrx.channels).toBe(3);
    expect([...bgrx.pixels]).toEqual([3, 2, 1]);
  });

  it('decodes alpha from bitfields, in every header version', () => {
    for (const headerSize of [40, 56, 108, 124]) {
      const bmp = buildBMP({
        width: 1,
        height: 1,
        bitsPerPixel: 32,
        headerSize,
        compression: headerSize === 40 ? 6 : 3,
        masks: [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000],
        rows: [[30, 20, 10, 128]],
      });
      const decoded = BMPdecode(bmp);
      expect(decoded.channels, `header ${headerSize}`).toBe(4);
      expect([...decoded.pixels]).toEqual([10, 20, 30, 128]);
    }
  });

  it('decodes OS/2 core header images', () => {
    const bmp = buildBMP({
      width: 2,
      height: 1,
      bitsPerPixel: 8,
      headerSize: 12,
      palette: [red, green],
      rows: [[1, 0]],
    });
    expect([...BMPdecode(bmp).pixels]).toEqual([...green, ...red]);
  });

  it('refuses invalid and unsupported images', () => {
    const rle = buildBMP({
      width: 1,
      height: 1,
      bitsPerPixel: 8,
      compression: 1,
      palette: [red],
      rows: [[0]],
    });
    expect(() => BMPdecode(rle)).toThrow(/Compressed/);

    const truncated = buildBMP({
      width: 100,
      height: 100,
      bitsPerPixel: 24,
      rows: [],
    }).subarray(0, 200);
    expect(() => BMPdecode(truncated)).toThrow(/truncated/);

    const huge = buildBMP({
      width: 1,
      height: 1,
      bitsPerPixel: 24,
      rows: [[0, 0, 0]],
    });
    huge.writeInt32LE(1_000_000, 18);
    huge.writeInt32LE(1_000_000, 22);
    expect(() => BMPdecode(huge)).toThrow(/dimensions/);

    expect(() => BMPdecode(Buffer.from('BM'))).toThrow();
    expect(() => BMPdecode(Buffer.from('GIF89a......'))).toThrow();
  });
});
