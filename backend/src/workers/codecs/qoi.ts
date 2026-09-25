// Encoder and decoder for the "Quite OK Image" format, following the
// specification at https://qoiformat.org/qoi-specification.pdf
//
// Picsur stores the master copy of every still image as QOI. This used to be
// done by a native addon, which stopped compiling on newer Node versions. The
// format is simple enough that plain TypeScript is fast enough, and it can not
// corrupt memory when fed a malicious file.

export interface QOIImage {
  pixels: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
}

const MAGIC = 0x716f6966; // "qoif"
const HEADER_SIZE = 14;
const END_MARKER = [0, 0, 0, 0, 0, 0, 0, 1];

const OP_INDEX = 0x00; // 00xxxxxx
const OP_DIFF = 0x40; // 01xxxxxx
const OP_LUMA = 0x80; // 10xxxxxx
const OP_RUN = 0xc0; // 11xxxxxx
const OP_RGB = 0xfe;
const OP_RGBA = 0xff;
const MASK_2 = 0xc0;

// Refuse to decode images larger than this, to not be tricked into allocating
// huge buffers by a tiny file with a made up header. Same as sharp's default
// limit for other formats.
export const QOI_MAX_PIXELS = 0x3fff * 0x3fff;

export function IsQOI(data: Buffer): boolean {
  return data.length >= HEADER_SIZE && data.readUInt32BE(0) === MAGIC;
}

function hash(r: number, g: number, b: number, a: number) {
  return (r * 3 + g * 5 + b * 7 + a * 11) % 64;
}

export function QOIencode(
  pixels: Buffer,
  options: { width: number; height: number; channels: 3 | 4 },
): Buffer {
  const { width, height, channels } = options;
  if (channels !== 3 && channels !== 4) {
    throw new Error('QOI only supports 3 or 4 channels');
  }
  if (width <= 0 || height <= 0 || width * height > QOI_MAX_PIXELS) {
    throw new Error('Invalid QOI dimensions');
  }
  const pixelCount = width * height;
  if (pixels.length !== pixelCount * channels) {
    throw new Error('Pixel data does not match the given dimensions');
  }

  // Worst case every pixel is an OP_RGBA
  const out = Buffer.allocUnsafe(
    HEADER_SIZE + pixelCount * (channels + 1) + END_MARKER.length,
  );
  out.writeUInt32BE(MAGIC, 0);
  out.writeUInt32BE(width, 4);
  out.writeUInt32BE(height, 8);
  out[12] = channels;
  out[13] = 0; // sRGB with linear alpha

  const index = new Uint8Array(64 * 4);
  let p = HEADER_SIZE;
  let run = 0;
  let pr = 0,
    pg = 0,
    pb = 0,
    pa = 255;

  const lastOffset = pixels.length - channels;
  for (let offset = 0; offset < pixels.length; offset += channels) {
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    const a = channels === 4 ? pixels[offset + 3] : pa;

    if (r === pr && g === pg && b === pb && a === pa) {
      run++;
      if (run === 62 || offset === lastOffset) {
        out[p++] = OP_RUN | (run - 1);
        run = 0;
      }
      continue;
    }

    if (run > 0) {
      out[p++] = OP_RUN | (run - 1);
      run = 0;
    }

    const h = hash(r, g, b, a) * 4;
    if (
      index[h] === r &&
      index[h + 1] === g &&
      index[h + 2] === b &&
      index[h + 3] === a
    ) {
      out[p++] = OP_INDEX | (h / 4);
    } else {
      index[h] = r;
      index[h + 1] = g;
      index[h + 2] = b;
      index[h + 3] = a;

      if (a === pa) {
        // Differences wrap around, as the spec works with 8 bit arithmetic
        const vr = ((r - pr + 384) % 256) - 128;
        const vg = ((g - pg + 384) % 256) - 128;
        const vb = ((b - pb + 384) % 256) - 128;
        const vgr = vr - vg;
        const vgb = vb - vg;

        if (vr > -3 && vr < 2 && vg > -3 && vg < 2 && vb > -3 && vb < 2) {
          out[p++] = OP_DIFF | ((vr + 2) << 4) | ((vg + 2) << 2) | (vb + 2);
        } else if (
          vgr > -9 &&
          vgr < 8 &&
          vg > -33 &&
          vg < 32 &&
          vgb > -9 &&
          vgb < 8
        ) {
          out[p++] = OP_LUMA | (vg + 32);
          out[p++] = ((vgr + 8) << 4) | (vgb + 8);
        } else {
          out[p++] = OP_RGB;
          out[p++] = r;
          out[p++] = g;
          out[p++] = b;
        }
      } else {
        out[p++] = OP_RGBA;
        out[p++] = r;
        out[p++] = g;
        out[p++] = b;
        out[p++] = a;
      }
    }

    pr = r;
    pg = g;
    pb = b;
    pa = a;
  }

  for (const byte of END_MARKER) out[p++] = byte;

  return Buffer.from(out.subarray(0, p));
}

export function QOIdecode(data: Buffer): QOIImage {
  if (!IsQOI(data)) throw new Error('Not a QOI image');

  const width = data.readUInt32BE(4);
  const height = data.readUInt32BE(8);
  const channels = data[12];
  if (channels !== 3 && channels !== 4) {
    throw new Error('Invalid QOI channel count');
  }
  if (width === 0 || height === 0 || width * height > QOI_MAX_PIXELS) {
    throw new Error('Invalid QOI dimensions');
  }

  const pixels = Buffer.alloc(width * height * channels);
  const index = new Uint8Array(64 * 4);
  let r = 0,
    g = 0,
    b = 0,
    a = 255;
  let run = 0;
  let p = HEADER_SIZE;
  const chunksEnd = data.length - END_MARKER.length;

  for (let offset = 0; offset < pixels.length; offset += channels) {
    if (run > 0) {
      run--;
    } else if (p < chunksEnd) {
      const b1 = data[p++];

      if (b1 === OP_RGB) {
        r = data[p++];
        g = data[p++];
        b = data[p++];
      } else if (b1 === OP_RGBA) {
        r = data[p++];
        g = data[p++];
        b = data[p++];
        a = data[p++];
      } else if ((b1 & MASK_2) === OP_INDEX) {
        const i = b1 * 4;
        r = index[i];
        g = index[i + 1];
        b = index[i + 2];
        a = index[i + 3];
      } else if ((b1 & MASK_2) === OP_DIFF) {
        r = (r + ((b1 >> 4) & 0x03) - 2) & 0xff;
        g = (g + ((b1 >> 2) & 0x03) - 2) & 0xff;
        b = (b + (b1 & 0x03) - 2) & 0xff;
      } else if ((b1 & MASK_2) === OP_LUMA) {
        const b2 = data[p++];
        const vg = (b1 & 0x3f) - 32;
        r = (r + vg - 8 + ((b2 >> 4) & 0x0f)) & 0xff;
        g = (g + vg) & 0xff;
        b = (b + vg - 8 + (b2 & 0x0f)) & 0xff;
      } else {
        // OP_RUN, the current pixel is the first of the run
        run = b1 & 0x3f;
      }

      const h = hash(r, g, b, a) * 4;
      index[h] = r;
      index[h + 1] = g;
      index[h + 2] = b;
      index[h + 3] = a;
    }
    // Like the reference decoder, truncated data repeats the last pixel

    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
    if (channels === 4) pixels[offset + 3] = a;
  }

  return { pixels, width, height, channels };
}
