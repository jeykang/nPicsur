// Animated PNG, following https://wiki.mozilla.org/APNG_Specification
//
// libvips reads only the first image of an APNG. So its frames are taken out
// here, each as a PNG of its own that libvips can decode, and put together
// again the way the specification says. Written the other way around: every
// frame encoded as a PNG by libvips, and put into one APNG.

import { crc32 } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Refuse animations with more pixels than this in all frames together, to not
// be tricked into allocating huge buffers by a small file
export const APNG_MAX_PIXELS = 0x3fff * 0x3fff;

export enum APNGDispose {
  // Leave the canvas as it is
  None = 0,
  // Clear the frame's area to transparent black
  Background = 1,
  // Put the frame's area back to how it was before the frame
  Previous = 2,
}

export enum APNGBlend {
  // Replace the frame's area
  Source = 0,
  // Draw over what is there
  Over = 1,
}

export interface APNGFrame {
  // Just this frame, as a PNG image of its own
  png: Buffer;
  x: number;
  y: number;
  width: number;
  height: number;
  // In milliseconds
  delay: number;
  dispose: APNGDispose;
  blend: APNGBlend;
}

export interface APNGAnimation {
  width: number;
  height: number;
  frames: APNGFrame[];
  // How many times it plays, 0 for forever
  loop: number;
  // What programs without APNG support show, which is not always one of the
  // frames. It has the EXIF data of the animation, which the frames leave
  // out: they are put together as they are stored, and turned after.
  defaultImage: Buffer;
}

interface Chunk {
  type: string;
  data: Buffer;
}

function readChunks(data: Buffer): Chunk[] {
  if (data.length < 8 || !data.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('Not a PNG image');
  }
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > data.length) throw new Error('Truncated PNG chunk');
    chunks.push({ type, data: data.subarray(offset + 8, offset + 8 + length) });
    offset = end;
    if (type === 'IEND') break;
  }
  if (chunks[0]?.type !== 'IHDR' || chunks[0].data.length !== 13) {
    throw new Error('PNG image without a header');
  }
  return chunks;
}

function writeChunk(type: string, data: Buffer): Buffer {
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

// Whether a PNG image is animated
export function IsAPNG(data: Buffer): boolean {
  try {
    for (const chunk of readChunks(data)) {
      if (chunk.type === 'acTL') return true;
      // The animation control has to come before the image data
      if (chunk.type === 'IDAT') return false;
    }
  } catch {
    // Not a PNG image, or a broken one
  }
  return false;
}

// Chunks that say how pixel values are to be read, every frame needs them
const SharedChunks = new Set([
  'PLTE',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'cICP',
]);

// Takes the frames out of an APNG, as PNG images of their own
export function APNGsplit(data: Buffer): APNGAnimation {
  const chunks = readChunks(data);
  const header = chunks[0].data;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  if (width === 0 || height === 0) throw new Error('Empty PNG image');

  const shared: Buffer[] = [];
  const defaultData: Buffer[] = [];
  let exif: Buffer | null = null;
  let loop = 0;
  let declaredFrames = 0;

  // The frame being read, and the data of its image
  let control: Omit<APNGFrame, 'png'> | null = null;
  let frameData: Buffer[] = [];
  const frames: APNGFrame[] = [];
  let totalPixels = 0;

  const png = (w: number, h: number, parts: Buffer[], extra: Buffer[] = []) => {
    const frameHeader = Buffer.from(header);
    frameHeader.writeUInt32BE(w, 0);
    frameHeader.writeUInt32BE(h, 4);
    return Buffer.concat([
      SIGNATURE,
      writeChunk('IHDR', frameHeader),
      ...shared,
      ...extra,
      ...parts.map((part) => writeChunk('IDAT', part)),
      writeChunk('IEND', Buffer.alloc(0)),
    ]);
  };
  const finishFrame = () => {
    if (control === null) return;
    if (frameData.length === 0) throw new Error('APNG frame without data');
    frames.push({
      ...control,
      png: png(control.width, control.height, frameData),
    });
    control = null;
    frameData = [];
  };

  let seenData = false;
  for (const { type, data: chunk } of chunks.slice(1)) {
    const size = { acTL: 8, fcTL: 26 }[type];
    if (size !== undefined && chunk.length !== size) {
      throw new Error(`Invalid APNG ${type} chunk`);
    }
    if (type === 'fdAT' && chunk.length < 4) {
      throw new Error('Invalid APNG fdAT chunk');
    }

    if (type === 'acTL') {
      declaredFrames = chunk.readUInt32BE(0);
      loop = chunk.readUInt32BE(4);
    } else if (type === 'fcTL') {
      finishFrame();
      const frame = {
        width: chunk.readUInt32BE(4),
        height: chunk.readUInt32BE(8),
        x: chunk.readUInt32BE(12),
        y: chunk.readUInt32BE(16),
        // A denominator of 0 means hundredths of a second
        delay: Math.round(
          (chunk.readUInt16BE(20) * 1000) / (chunk.readUInt16BE(22) || 100),
        ),
        dispose: chunk[24] as APNGDispose,
        blend: chunk[25] as APNGBlend,
      };
      if (
        frame.width === 0 ||
        frame.height === 0 ||
        frame.x + frame.width > width ||
        frame.y + frame.height > height ||
        frame.dispose > APNGDispose.Previous ||
        frame.blend > APNGBlend.Over
      ) {
        throw new Error('Invalid APNG frame');
      }
      totalPixels += width * height;
      if (totalPixels > APNG_MAX_PIXELS) throw new Error('APNG is too large');
      control = frame;
    } else if (type === 'IDAT') {
      seenData = true;
      defaultData.push(chunk);
      // Only part of the animation when a frame control came before it
      if (control !== null) frameData.push(chunk);
    } else if (type === 'fdAT') {
      if (control === null) throw new Error('APNG frame data without a frame');
      frameData.push(chunk.subarray(4));
    } else if (SharedChunks.has(type) && !seenData) {
      shared.push(writeChunk(type, chunk));
    } else if (type === 'eXIf' && exif === null) {
      exif = writeChunk(type, chunk);
    }
  }
  finishFrame();

  if (declaredFrames === 0 || frames.length === 0) {
    throw new Error('APNG without frames');
  }
  if (defaultData.length === 0) throw new Error('PNG image without data');

  return {
    width,
    height,
    frames,
    loop,
    defaultImage: png(width, height, defaultData, exif ? [exif] : []),
  };
}

// Puts the frames together, from their decoded RGBA pixels. Returns every
// frame as it is shown, in RGBA, one after the other.
export function APNGcompose(
  animation: Pick<APNGAnimation, 'width' | 'height' | 'frames'>,
  pixels: Buffer[],
): Buffer {
  const { width, height, frames } = animation;
  const frameSize = width * height * 4;
  const out = Buffer.alloc(frameSize * frames.length);
  const canvas = Buffer.alloc(frameSize);

  frames.forEach((frame, index) => {
    const source = pixels[index];
    if (source.length !== frame.width * frame.height * 4) {
      throw new Error('APNG frame pixels do not match its size');
    }

    // What the area looked like before this frame, to put it back after
    let before: Buffer | null = null;
    const dispose =
      // The first frame can not go back to before it
      index === 0 && frame.dispose === APNGDispose.Previous
        ? APNGDispose.Background
        : frame.dispose;
    if (dispose === APNGDispose.Previous) {
      before = Buffer.alloc(frame.width * frame.height * 4);
      copyArea(canvas, width, frame, before, false);
    }

    for (let row = 0; row < frame.height; row++) {
      for (let column = 0; column < frame.width; column++) {
        const from = (row * frame.width + column) * 4;
        const to = ((frame.y + row) * width + frame.x + column) * 4;
        const alpha = source[from + 3];
        if (frame.blend === APNGBlend.Source || alpha === 255) {
          source.copy(canvas, to, from, from + 4);
        } else if (alpha !== 0) {
          blendOver(source, from, canvas, to);
        }
      }
    }

    canvas.copy(out, index * frameSize);

    if (dispose === APNGDispose.Background) {
      for (let row = 0; row < frame.height; row++) {
        const start = ((frame.y + row) * width + frame.x) * 4;
        canvas.fill(0, start, start + frame.width * 4);
      }
    } else if (before !== null) {
      copyArea(canvas, width, frame, before, true);
    }
  });

  return out;
}

// Copies the area of a frame out of the canvas, or back into it
function copyArea(
  canvas: Buffer,
  width: number,
  area: { x: number; y: number; width: number; height: number },
  copy: Buffer,
  back: boolean,
) {
  for (let row = 0; row < area.height; row++) {
    const start = ((area.y + row) * width + area.x) * 4;
    const saved = row * area.width * 4;
    if (back) copy.copy(canvas, start, saved, saved + area.width * 4);
    else canvas.copy(copy, saved, start, start + area.width * 4);
  }
}

// Draws a pixel over another one, both with straight alpha
function blendOver(source: Buffer, from: number, target: Buffer, to: number) {
  const sourceAlpha = source[from + 3] / 255;
  const targetAlpha = (target[to + 3] / 255) * (1 - sourceAlpha);
  const alpha = sourceAlpha + targetAlpha;
  for (let channel = 0; channel < 3; channel++) {
    target[to + channel] = Math.round(
      (source[from + channel] * sourceAlpha +
        target[to + channel] * targetAlpha) /
        alpha,
    );
  }
  target[to + 3] = Math.round(alpha * 255);
}

// Makes an APNG out of frames that are PNG images of the whole canvas, all
// written the same way
export function APNGencode(
  frames: Buffer[],
  options: { delays: number[]; loop: number },
): Buffer {
  if (frames.length === 0) throw new Error('An animation needs frames');

  const parsed = frames.map(readChunks);
  const header = parsed[0][0].data;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);

  const animationControl = Buffer.alloc(8);
  animationControl.writeUInt32BE(frames.length, 0);
  animationControl.writeUInt32BE(options.loop, 4);

  const parts: Buffer[] = [
    SIGNATURE,
    writeChunk('IHDR', header),
    writeChunk('acTL', animationControl),
    // What the first frame needs to be read right, like its palette
    ...parsed[0]
      .filter((chunk) => SharedChunks.has(chunk.type))
      .map((chunk) => writeChunk(chunk.type, chunk.data)),
  ];

  let sequence = 0;
  parsed.forEach((chunks, index) => {
    const frameHeader = chunks[0].data;
    if (!frameHeader.equals(header)) {
      throw new Error('APNG frames have to be written the same way');
    }

    const frameControl = Buffer.alloc(26);
    frameControl.writeUInt32BE(sequence++, 0);
    frameControl.writeUInt32BE(width, 4);
    frameControl.writeUInt32BE(height, 8);
    // Offsets of 0, the delay in milliseconds
    frameControl.writeUInt16BE(
      Math.min(Math.max(Math.round(options.delays[index] ?? 100), 0), 0xffff),
      20,
    );
    frameControl.writeUInt16BE(1000, 22);
    frameControl[24] = APNGDispose.None;
    frameControl[25] = APNGBlend.Source;
    parts.push(writeChunk('fcTL', frameControl));

    for (const chunk of chunks) {
      if (chunk.type !== 'IDAT') continue;
      if (index === 0) {
        parts.push(writeChunk('IDAT', chunk.data));
      } else {
        const numbered = Buffer.alloc(4 + chunk.data.length);
        numbered.writeUInt32BE(sequence++, 0);
        chunk.data.copy(numbered, 4);
        parts.push(writeChunk('fdAT', numbered));
      }
    }
  });

  parts.push(writeChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
