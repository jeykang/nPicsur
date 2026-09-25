import { randomBytes } from 'node:crypto';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  APNGBlend,
  APNGcompose,
  APNGDispose,
  APNGencode,
  APNGsplit,
  IsAPNG,
} from '../../src/workers/codecs/apng.js';
import { ICOdecode, ICOencode } from '../../src/workers/codecs/ico.js';
import { IsTGA, TGAdecode, TGAencode } from '../../src/workers/codecs/tga.js';

// TGA ========================================================================

function tgaHeader(fields: {
  idLength?: number;
  colorMapType?: number;
  type: number;
  colorMapStart?: number;
  colorMapLength?: number;
  colorMapDepth?: number;
  width: number;
  height: number;
  depth: number;
  descriptor?: number;
}): Buffer {
  const header = Buffer.alloc(18);
  header[0] = fields.idLength ?? 0;
  header[1] = fields.colorMapType ?? 0;
  header[2] = fields.type;
  header.writeUInt16LE(fields.colorMapStart ?? 0, 3);
  header.writeUInt16LE(fields.colorMapLength ?? 0, 5);
  header[7] = fields.colorMapDepth ?? 0;
  header.writeUInt16LE(fields.width, 12);
  header.writeUInt16LE(fields.height, 14);
  header[16] = fields.depth;
  header[17] = fields.descriptor ?? 0;
  return header;
}

describe('TGA', () => {
  it.each([3, 4] as const)('round trips %d channels', (channels) => {
    const pixels = randomBytes(7 * 5 * channels);
    const encoded = TGAencode(pixels, { width: 7, height: 5, channels });
    expect(IsTGA(encoded)).toBe(true);
    const decoded = TGAdecode(encoded);
    // Random alpha is never all zeroes
    expect(decoded).toMatchObject({ width: 7, height: 5, channels });
    expect(decoded.pixels.equals(pixels)).toBe(true);
  });

  it('decodes bottom-up images without a footer', () => {
    // 2x2, BGR, the bottom row first
    const data = Buffer.concat([
      tgaHeader({ type: 2, width: 2, height: 2, depth: 24 }),
      Buffer.from([3, 2, 1, 6, 5, 4]), // bottom: (1,2,3) (4,5,6)
      Buffer.from([9, 8, 7, 12, 11, 10]), // top: (7,8,9) (10,11,12)
    ]);
    expect(IsTGA(data)).toBe(true);
    expect(TGAdecode(data)).toEqual({
      width: 2,
      height: 2,
      channels: 3,
      pixels: Buffer.from([7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]),
    });
    // Right to left as well
    data[17] = 0x10;
    expect(TGAdecode(data).pixels).toEqual(
      Buffer.from([10, 11, 12, 7, 8, 9, 4, 5, 6, 1, 2, 3]),
    );
  });

  it('decodes run length encoded images, with runs across rows', () => {
    const data = Buffer.concat([
      tgaHeader({
        type: 10,
        width: 3,
        height: 2,
        depth: 32,
        descriptor: 0x28, // top to bottom, 8 alpha bits
        idLength: 2,
      }),
      Buffer.from('id'),
      // 4 times the same pixel, then 2 different ones
      Buffer.from([0x83, 30, 20, 10, 128]),
      Buffer.from([0x01, 1, 2, 3, 255, 4, 5, 6, 0]),
    ]);
    expect(IsTGA(data)).toBe(true);
    expect(TGAdecode(data)).toEqual({
      width: 3,
      height: 2,
      channels: 4,
      pixels: Buffer.from([
        10, 20, 30, 128, 10, 20, 30, 128, 10, 20, 30, 128, 10, 20, 30, 128, 3,
        2, 1, 255, 6, 5, 4, 0,
      ]),
    });
  });

  it('decodes color-mapped and greyscale images', () => {
    // A palette starting at index 5, of 24 bit BGR colors
    const mapped = Buffer.concat([
      tgaHeader({
        type: 1,
        colorMapType: 1,
        colorMapStart: 5,
        colorMapLength: 2,
        colorMapDepth: 24,
        width: 2,
        height: 1,
        depth: 8,
        descriptor: 0x20,
      }),
      Buffer.from([30, 20, 10, 60, 50, 40]),
      Buffer.from([6, 5]),
    ]);
    expect(TGAdecode(mapped).pixels).toEqual(
      Buffer.from([40, 50, 60, 10, 20, 30]),
    );

    const grey = Buffer.concat([
      tgaHeader({ type: 11, width: 3, height: 1, depth: 8, descriptor: 0x20 }),
      Buffer.from([0x82, 77]),
    ]);
    expect(TGAdecode(grey)).toEqual({
      width: 3,
      height: 1,
      channels: 3,
      pixels: Buffer.from([77, 77, 77, 77, 77, 77, 77, 77, 77]),
    });

    const greyAlpha = Buffer.concat([
      tgaHeader({ type: 3, width: 1, height: 1, depth: 16, descriptor: 0x28 }),
      Buffer.from([200, 100]),
    ]);
    expect(TGAdecode(greyAlpha).pixels).toEqual(
      Buffer.from([200, 200, 200, 100]),
    );
  });

  it('decodes 15 and 16 bit images', () => {
    // Red, and a transparent green: A RRRRR GGGGG BBBBB
    const pixels = Buffer.alloc(4);
    pixels.writeUInt16LE(0x8000 | (31 << 10), 0);
    pixels.writeUInt16LE(31 << 5, 2);
    const data = Buffer.concat([
      tgaHeader({ type: 2, width: 2, height: 1, depth: 16, descriptor: 0x21 }),
      pixels,
    ]);
    expect(TGAdecode(data).pixels).toEqual(
      Buffer.from([255, 0, 0, 255, 0, 255, 0, 0]),
    );

    // Without alpha bits the top bit means nothing
    data[16] = 15;
    data[17] = 0x20;
    expect(TGAdecode(data)).toMatchObject({
      channels: 3,
      pixels: Buffer.from([255, 0, 0, 0, 255, 0]),
    });
  });

  it('ignores alpha that is all zeroes', () => {
    const data = Buffer.concat([
      tgaHeader({ type: 2, width: 2, height: 1, depth: 32, descriptor: 0x20 }),
      Buffer.from([1, 2, 3, 0, 4, 5, 6, 0]),
    ]);
    expect(TGAdecode(data)).toMatchObject({
      channels: 3,
      pixels: Buffer.from([3, 2, 1, 6, 5, 4]),
    });
  });

  it('refuses invalid images', () => {
    const valid = Buffer.concat([
      tgaHeader({ type: 2, width: 2, height: 2, depth: 24 }),
      Buffer.alloc(12),
    ]);
    expect(() => TGAdecode(valid.subarray(0, 25))).toThrow();
    expect(() => TGAdecode(Buffer.from('not an image at all!'))).toThrow();

    const huge = tgaHeader({ type: 2, width: 65535, height: 65535, depth: 24 });
    expect(() => TGAdecode(huge)).toThrow(/too large/);

    // A run past the end of the image
    const longRun = Buffer.concat([
      tgaHeader({ type: 10, width: 2, height: 1, depth: 24 }),
      Buffer.from([0x85, 1, 2, 3]),
    ]);
    expect(() => TGAdecode(longRun)).toThrow();

    const badIndex = Buffer.concat([
      tgaHeader({
        type: 1,
        colorMapType: 1,
        colorMapLength: 1,
        colorMapDepth: 24,
        width: 1,
        height: 1,
        depth: 8,
      }),
      Buffer.from([1, 2, 3, 7]),
    ]);
    expect(() => TGAdecode(badIndex)).toThrow(/out of range/);
  });

  it('does not take other files for TGA images', async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#f80' },
    })
      .png()
      .toBuffer();
    const jpeg = await sharp(png).jpeg().toBuffer();
    for (const data of [png, jpeg, Buffer.from('hello world, nothing here')]) {
      expect(IsTGA(data)).toBe(false);
    }
    // Too short for what its header says
    expect(
      IsTGA(tgaHeader({ type: 2, width: 100, height: 100, depth: 24 })),
    ).toBe(false);
  });
});

// ICO ========================================================================

// A bitmap as stored in an icon: a header saying twice the height, the
// palette, the colors bottom-up, and the transparency mask
function iconBitmap(options: {
  width: number;
  height: number;
  bits: number;
  palette?: number[][];
  rows: Buffer[];
  mask?: Buffer[];
}): Buffer {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(options.width, 4);
  header.writeInt32LE(options.height * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(options.bits, 14);
  header.writeUInt32LE(options.palette?.length ?? 0, 32);
  const palette = Buffer.from(
    (options.palette ?? []).flatMap(([r, g, b]) => [b, g, r, 0]),
  );
  const pad = (row: Buffer) => {
    const stride = Math.ceil(row.length / 4) * 4;
    return Buffer.concat([row, Buffer.alloc(stride - row.length)]);
  };
  return Buffer.concat([
    header,
    palette,
    ...[...options.rows].reverse().map(pad),
    ...[...(options.mask ?? [])].reverse().map(pad),
  ]);
}

function icon(images: Buffer[], type = 1): Buffer {
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(type, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach((image, i) => {
    directory.writeUInt32LE(image.length, 6 + i * 16 + 8);
    directory.writeUInt32LE(offset, 6 + i * 16 + 12);
    offset += image.length;
  });
  return Buffer.concat([directory, ...images]);
}

function bitmapOf(decoded: ReturnType<typeof ICOdecode>) {
  if (!('bitmap' in decoded)) throw new Error('Not a bitmap');
  return decoded.bitmap;
}

describe('ICO', () => {
  it('writes and reads icons of PNG images, the largest one', async () => {
    const pngs = await Promise.all(
      [16, 48, 32].map((size) =>
        sharp({
          create: {
            width: size,
            height: size,
            channels: 4,
            background: '#08f',
          },
        })
          .png()
          .toBuffer()
          .then((png) => ({ png, width: size, height: size })),
      ),
    );
    const encoded = ICOencode(pngs);
    expect(encoded.readUInt16LE(4)).toBe(3);
    expect(ICOdecode(encoded)).toEqual({ png: pngs[1].png });

    // 256 is written as 0
    const big = await sharp({
      create: { width: 256, height: 256, channels: 4, background: '#fff' },
    })
      .png()
      .toBuffer();
    const bigIcon = ICOencode([{ png: big, width: 256, height: 256 }]);
    expect(bigIcon[6]).toBe(0);
    expect(() => ICOencode([{ png: big, width: 257, height: 256 }])).toThrow();
  });

  it('reads 32 bit images with alpha, and uses the mask when there is none', () => {
    const rows = [
      Buffer.from([3, 2, 1, 255, 6, 5, 4, 128]),
      Buffer.from([9, 8, 7, 0, 12, 11, 10, 255]),
    ];
    const withAlpha = iconBitmap({ width: 2, height: 2, bits: 32, rows });
    expect(bitmapOf(ICOdecode(icon([withAlpha])))).toEqual({
      width: 2,
      height: 2,
      channels: 4,
      pixels: Buffer.from([
        1, 2, 3, 255, 4, 5, 6, 128, 7, 8, 9, 0, 10, 11, 12, 255,
      ]),
    });

    const noAlpha = iconBitmap({
      width: 2,
      height: 2,
      bits: 32,
      rows: rows.map(
        (row) => row.map((v, i) => (i % 4 === 3 ? 0 : v)) as Buffer,
      ),
      // The second pixel of the first row is transparent
      mask: [Buffer.from([0b01000000]), Buffer.from([0])],
    });
    expect(bitmapOf(ICOdecode(icon([noAlpha]))).pixels).toEqual(
      Buffer.from([1, 2, 3, 255, 4, 5, 6, 0, 7, 8, 9, 255, 10, 11, 12, 255]),
    );
  });

  it('reads palette and 24 bit images with their mask', () => {
    const palette = [
      [0, 0, 0],
      [255, 0, 0],
      [0, 255, 0],
    ];
    const mask = [Buffer.from([0b10000000]), Buffer.from([0])];
    const expected = Buffer.from([
      255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255,
    ]);

    const eight = iconBitmap({
      width: 2,
      height: 2,
      bits: 8,
      palette,
      rows: [Buffer.from([1, 2]), Buffer.from([0, 1])],
      mask,
    });
    expect(bitmapOf(ICOdecode(icon([eight]))).pixels).toEqual(expected);

    const four = iconBitmap({
      width: 2,
      height: 2,
      bits: 4,
      palette,
      rows: [Buffer.from([0x12]), Buffer.from([0x01])],
      mask,
    });
    expect(bitmapOf(ICOdecode(icon([four]))).pixels).toEqual(expected);

    const one = iconBitmap({
      width: 2,
      height: 2,
      bits: 1,
      palette: [
        [0, 0, 0],
        [255, 255, 255],
      ],
      rows: [Buffer.from([0b10000000]), Buffer.from([0b01000000])],
      mask,
    });
    expect(bitmapOf(ICOdecode(icon([one]))).pixels).toEqual(
      Buffer.from([
        255, 255, 255, 0, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
      ]),
    );

    const twentyFour = iconBitmap({
      width: 1,
      height: 1,
      bits: 24,
      rows: [Buffer.from([3, 2, 1])],
      mask: [Buffer.from([0])],
    });
    expect(bitmapOf(ICOdecode(icon([twentyFour], 2))).pixels).toEqual(
      Buffer.from([1, 2, 3, 255]),
    );
  });

  it('picks the largest bitmap, with the most colors', () => {
    const small = iconBitmap({
      width: 1,
      height: 1,
      bits: 24,
      rows: [Buffer.from([0, 0, 255])],
      mask: [Buffer.from([0])],
    });
    const large = iconBitmap({
      width: 2,
      height: 1,
      bits: 24,
      rows: [Buffer.from([0, 255, 0, 0, 255, 0])],
      mask: [Buffer.from([0])],
    });
    expect(bitmapOf(ICOdecode(icon([small, large, small]))).width).toBe(2);
  });

  it('refuses invalid icons', () => {
    const image = iconBitmap({
      width: 1,
      height: 1,
      bits: 24,
      rows: [Buffer.from([0, 0, 0])],
      mask: [Buffer.from([0])],
    });
    const valid = icon([image]);
    expect(() => ICOdecode(valid.subarray(0, valid.length - 10))).toThrow();
    expect(() => ICOdecode(icon([image], 3))).toThrow();
    expect(() => ICOdecode(icon([]))).toThrow();

    const compressed = Buffer.from(image);
    compressed.writeUInt32LE(1, 16);
    expect(() => ICOdecode(icon([compressed]))).toThrow(/Unsupported/);

    const oddHeight = Buffer.from(image);
    oddHeight.writeInt32LE(3, 8);
    expect(() => ICOdecode(icon([oddHeight]))).toThrow();

    const hugeWidth = Buffer.from(image);
    hugeWidth.writeInt32LE(0x7fffffff, 4);
    expect(() => ICOdecode(icon([hugeWidth]))).toThrow();
  });
});

// APNG =======================================================================

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(
    crc32(out.subarray(4, 8 + data.length)) >>> 0,
    8 + data.length,
  );
  return out;
}

// The chunks of a PNG image
function chunks(png: Buffer): { type: string; data: Buffer }[] {
  const out: { type: string; data: Buffer }[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    out.push({
      type: png.toString('latin1', at + 4, at + 8),
      data: png.subarray(at + 8, at + 8 + length),
    });
    at += 12 + length;
  }
  return out;
}

async function solid(
  width: number,
  height: number,
  rgba: [number, number, number, number],
) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: rgba[0], g: rgba[1], b: rgba[2], alpha: rgba[3] / 255 },
    },
  })
    .png()
    .toBuffer();
}

interface FrameSpec {
  png: Buffer;
  x: number;
  y: number;
  delay?: number;
  dispose?: APNGDispose;
  blend?: APNGBlend;
}

// An APNG with frames of any size and position, which the encoder here never
// writes. The default image is the first frame, unless one is given.
function buildApng(
  width: number,
  height: number,
  frames: FrameSpec[],
  hiddenDefault?: Buffer,
): Buffer {
  const header = Buffer.from(chunks(frames[0].png)[0].data);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(frames.length, 0);
  animation.writeUInt32BE(3, 4);

  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('acTL', animation),
  ];
  if (hiddenDefault) {
    for (const c of chunks(hiddenDefault)) {
      if (c.type === 'IDAT') parts.push(chunk('IDAT', c.data));
    }
  }
  let sequence = 0;
  frames.forEach((frame, index) => {
    const frameHeader = chunks(frame.png)[0].data;
    const control = Buffer.alloc(26);
    control.writeUInt32BE(sequence++, 0);
    control.writeUInt32BE(frameHeader.readUInt32BE(0), 4);
    control.writeUInt32BE(frameHeader.readUInt32BE(4), 8);
    control.writeUInt32BE(frame.x, 12);
    control.writeUInt32BE(frame.y, 16);
    control.writeUInt16BE(frame.delay ?? 10, 20);
    control.writeUInt16BE(100, 22);
    control[24] = frame.dispose ?? APNGDispose.None;
    control[25] = frame.blend ?? APNGBlend.Source;
    parts.push(chunk('fcTL', control));
    for (const c of chunks(frame.png)) {
      if (c.type !== 'IDAT') continue;
      if (index === 0 && !hiddenDefault) {
        parts.push(chunk('IDAT', c.data));
      } else {
        const numbered = Buffer.alloc(4 + c.data.length);
        numbered.writeUInt32BE(sequence++, 0);
        c.data.copy(numbered, 4);
        parts.push(chunk('fdAT', numbered));
      }
    }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

async function rgba(png: Buffer): Promise<Buffer> {
  return sharp(png).ensureAlpha().raw().toBuffer();
}

// The color of a pixel in a frame of composed RGBA frames
function pixel(
  frames: Buffer,
  width: number,
  height: number,
  frame: number,
  x: number,
  y: number,
) {
  const at = frame * width * height * 4 + (y * width + x) * 4;
  return [...frames.subarray(at, at + 4)];
}

describe('APNG', () => {
  it('writes animations that it reads back the same', async () => {
    const frames = await Promise.all([
      solid(4, 3, [255, 0, 0, 255]),
      solid(4, 3, [0, 255, 0, 128]),
      solid(4, 3, [0, 0, 255, 255]),
    ]);
    const apng = APNGencode(frames, { delays: [100, 250, 40], loop: 2 });
    expect(IsAPNG(apng)).toBe(true);
    expect(IsAPNG(frames[0])).toBe(false);
    // libvips reads it as the first frame
    expect(await rgba(apng)).toEqual(await rgba(frames[0]));

    const animation = APNGsplit(apng);
    expect(animation).toMatchObject({ width: 4, height: 3, loop: 2 });
    expect(animation.frames.map((frame) => frame.delay)).toEqual([
      100, 250, 40,
    ]);
    const decoded = await Promise.all(animation.frames.map((f) => rgba(f.png)));
    expect(decoded).toEqual(await Promise.all(frames.map(rgba)));
    expect(await rgba(animation.defaultImage)).toEqual(await rgba(frames[0]));
  });

  it('puts frames together the way they say', async () => {
    const red = await solid(4, 4, [255, 0, 0, 255]);
    const green = await solid(2, 2, [0, 255, 0, 255]);
    const halfBlue = await solid(1, 1, [0, 0, 255, 128]);
    const clear = await solid(1, 1, [0, 0, 0, 0]);

    const apng = buildApng(4, 4, [
      { png: red, x: 0, y: 0 },
      // Cleared again after it is shown
      { png: green, x: 1, y: 1, dispose: APNGDispose.Background },
      // Drawn over the red, and put back to how it was after
      {
        png: halfBlue,
        x: 0,
        y: 0,
        blend: APNGBlend.Over,
        dispose: APNGDispose.Previous,
      },
      // Replaces the pixel, transparent included
      { png: clear, x: 3, y: 3, blend: APNGBlend.Source },
      // Transparent drawn over something changes nothing
      { png: clear, x: 0, y: 0, blend: APNGBlend.Over },
    ]);

    const animation = APNGsplit(apng);
    const decoded = await Promise.all(animation.frames.map((f) => rgba(f.png)));
    const frames = APNGcompose(animation, decoded);
    const at = (frame: number, x: number, y: number) =>
      pixel(frames, 4, 4, frame, x, y);

    expect(at(0, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(at(1, 1, 1)).toEqual([0, 255, 0, 255]);
    expect(at(1, 0, 0)).toEqual([255, 0, 0, 255]);
    // The green was cleared, the half transparent blue is over red
    expect(at(2, 1, 1)).toEqual([0, 0, 0, 0]);
    expect(at(2, 0, 0)).toEqual([127, 0, 128, 255]);
    // And the red is back
    expect(at(3, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(3, 3, 3)).toEqual([0, 0, 0, 0]);
    expect(at(4, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(4, 3, 3)).toEqual([0, 0, 0, 0]);
  });

  it('keeps a default image that is not part of the animation apart', async () => {
    const cover = await solid(2, 2, [255, 255, 255, 255]);
    const frame = await solid(2, 2, [0, 0, 0, 255]);
    const apng = buildApng(2, 2, [{ png: frame, x: 0, y: 0 }], cover);
    const animation = APNGsplit(apng);
    expect(animation.frames).toHaveLength(1);
    expect(await rgba(animation.defaultImage)).toEqual(await rgba(cover));
    expect(await rgba(animation.frames[0].png)).toEqual(await rgba(frame));
  });

  it('refuses invalid animations', async () => {
    const frame = await solid(2, 2, [0, 0, 0, 255]);
    // A frame that does not fit on the canvas
    expect(() =>
      APNGsplit(buildApng(2, 2, [{ png: frame, x: 1, y: 0 }])),
    ).toThrow(/Invalid APNG frame/);

    const valid = buildApng(2, 2, [{ png: frame, x: 0, y: 0 }]);
    expect(() => APNGsplit(valid.subarray(0, 60))).toThrow();
    expect(() => APNGsplit(frame)).toThrow(/without frames/);

    const invalidDispose = Buffer.from(valid);
    const control = invalidDispose.indexOf('fcTL') + 4;
    invalidDispose[control + 24] = 7;
    expect(() => APNGsplit(invalidDispose)).toThrow(/Invalid APNG frame/);
  });
});
