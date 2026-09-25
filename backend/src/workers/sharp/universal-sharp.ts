import {
  AnimFileType,
  FileType,
  ImageFileType,
} from 'picsur-shared/dist/dto/mimes.dto';
import sharp, { Channels, OutputInfo, Sharp, SharpOptions } from 'sharp';
import { APNGcompose, APNGencode, APNGsplit } from '../codecs/apng.js';
import { BMPdecode, BMPencode } from '../codecs/bmp.js';
import { ICOdecode, ICOencode } from '../codecs/ico.js';
import { QOIdecode, QOIencode } from '../codecs/qoi.js';
import { TGAdecode, TGAencode } from '../codecs/tga.js';
import { SharpWorkerFinishOptions } from './sharp.message.js';

export interface SharpResult {
  data: Buffer;
  info: OutputInfo;
}

// How an animation plays, when libvips does not know it from the input
export interface AnimationTiming {
  // In milliseconds, for every frame
  delay: number[];
  // How many times it plays, 0 for forever
  loop: number;
}

export interface SharpInput {
  image: Sharp;
  timing: AnimationTiming | null;
  // How many frames it has, 1 for still images
  pages: number;
}

export async function UniversalSharpIn(
  image: Buffer,
  filetype: FileType,
  options?: SharpOptions,
): Promise<SharpInput> {
  switch (filetype.identifier) {
    case ImageFileType.BMP:
      return untimed(rawSharpIn(BMPdecode(image), options));
    case ImageFileType.QOI:
      return untimed(rawSharpIn(QOIdecode(image), options));
    case ImageFileType.TGA:
      return untimed(rawSharpIn(TGAdecode(image), options));
    case ImageFileType.ICO: {
      const icon = ICOdecode(image);
      return untimed(
        'png' in icon
          ? sharp(icon.png, options)
          : rawSharpIn(icon.bitmap, options),
      );
    }
    case AnimFileType.APNG:
      return apngSharpIn(image, options);
    default:
      // Photos are often stored sideways, with their EXIF orientation saying
      // how to turn them. Masters of JPEGs keep it, and every conversion
      // applies it, other masters are turned when they are made.
      if (options?.animated) return animatedSharpIn(image, options);
      return untimed(sharp(image, { ...options, autoOrient: true }));
  }
}

// Still images, and animations libvips knows how to play
function untimed(image: Sharp, pages = 1): SharpInput {
  return { image, timing: null, pages };
}

function rawSharpIn(
  decoded: { pixels: Buffer; width: number; height: number; channels: 3 | 4 },
  options?: SharpOptions,
) {
  return sharp(decoded.pixels, {
    ...options,
    raw: {
      width: decoded.width,
      height: decoded.height,
      channels: decoded.channels,
    },
  });
}

// libvips only reads the first image of an APNG, so its frames are decoded
// one by one and put together here
async function apngSharpIn(
  image: Buffer,
  options?: SharpOptions,
): Promise<SharpInput> {
  const animation = APNGsplit(image);
  // What is shown without APNG support, which is what a still image of it is
  if (!options?.animated) {
    return untimed(
      sharp(animation.defaultImage, { ...options, autoOrient: true }),
    );
  }
  // Its EXIF data is only in the default image
  const { orientation } = await sharp(animation.defaultImage).metadata();

  const pixels: Buffer[] = [];
  for (const frame of animation.frames) {
    pixels.push(
      await sharp(frame.png)
        .toColourspace('srgb')
        .ensureAlpha()
        .raw({ depth: 'uchar' })
        .toBuffer(),
    );
  }
  const composed = APNGcompose(animation, pixels);
  // Without transparency, other formats need not store any
  const opaque = IsOpaque(composed);
  const frames = TurnFrames(
    opaque ? WithoutAlpha(composed) : composed,
    {
      width: animation.width,
      height: animation.height,
      channels: opaque ? 3 : 4,
      pages: animation.frames.length,
    },
    orientation,
  );

  return {
    image: framesSharpIn(frames, options),
    timing: {
      delay: animation.frames.map((frame) => frame.delay),
      loop: animation.loop,
    },
    pages: frames.pages,
  };
}

// libvips turns an animation upside down as one tall image, which plays its
// frames backwards, and can not turn it sideways at all. So animations that
// are stored turned have each of their frames turned by itself.
async function animatedSharpIn(
  image: Buffer,
  options: SharpOptions,
): Promise<SharpInput> {
  const { orientation, pages, delay, loop } = await sharp(
    image,
    options,
  ).metadata();
  if (!pages || pages === 1 || !Turns[orientation ?? 1]) {
    return untimed(sharp(image, { ...options, autoOrient: true }), pages);
  }

  const raw = await sharp(image, options)
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  const frames = TurnFrames(
    raw.data,
    {
      width: raw.info.width,
      height: raw.info.height / pages,
      channels: raw.info.channels,
      pages,
    },
    orientation,
  );

  return {
    image: framesSharpIn(frames, options),
    // How it plays does not come along with the raw frames
    timing: { delay: delay ?? [], loop: loop ?? 0 },
    pages,
  };
}

// Mirroring and turning, asked for when converting
export interface AnimationEdits {
  // Top to bottom, and left to right
  flip: boolean;
  flop: boolean;
  // Clockwise, in degrees
  angle: number;
}

// The same EXIF orientations as turning clockwise
const AngleOrientations: Partial<Record<number, number>> = {
  90: 6,
  180: 3,
  270: 8,
};

// Animations can only be mirrored and turned by libvips as one tall image of
// all their frames too, so that is done here frame by frame, after the other
// operations. In the same order as libvips does it for still images:
// mirrored first, then turned.
export async function EditAnimation(
  image: Sharp,
  timing: AnimationTiming | null,
  edits: AnimationEdits,
): Promise<SharpInput> {
  // How it plays, from the input when libvips read it as an animation
  const metadata = timing === null ? await image.metadata() : null;

  const raw = await image
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  // After resizing, the page height libvips reports is the one from before
  const pages = raw.info.pages ?? 1;
  let frames: Frames = {
    pixels: raw.data,
    width: raw.info.width,
    height: raw.info.height / pages,
    channels: raw.info.channels,
    pages,
  };
  if (!Number.isInteger(frames.height)) {
    throw new Error('Frames of different heights');
  }

  for (const orientation of [
    edits.flip ? 4 : 1,
    edits.flop ? 2 : 1,
    AngleOrientations[edits.angle % 360] ?? 1,
  ]) {
    frames = TurnFrames(frames.pixels, frames, orientation);
  }

  return {
    image: framesSharpIn(frames, { animated: true }),
    timing: timing ?? {
      delay: metadata?.delay ?? [],
      loop: metadata?.loop ?? 0,
    },
    pages,
  };
}

interface Frames {
  // Every frame, one after the other
  pixels: Buffer;
  // Of one frame
  width: number;
  height: number;
  channels: Channels;
  pages: number;
}

// Still animated, or operations like resizing would only keep the first
// frame
function framesSharpIn(frames: Frames, options?: SharpOptions): Sharp {
  return sharp(frames.pixels, {
    ...options,
    raw: {
      width: frames.width,
      height: frames.height * frames.pages,
      channels: frames.channels,
      pageHeight: frames.height,
    },
  });
}

// For the EXIF orientations that turn an image, of w by h pixels as stored:
// which stored pixel is shown at the top left, and how far away in the stored
// image the pixels are that are shown to the right of it and below it
const Turns: Partial<
  Record<number, (w: number, h: number) => [number, number, number]>
> = {
  // Mirrored
  2: (w) => [w - 1, -1, w],
  // Upside down, and mirrored
  3: (w, h) => [w * h - 1, -1, -w],
  4: (w, h) => [(h - 1) * w, 1, -w],
  // A quarter turned, with width and height swapped: mirrored, clockwise,
  // mirrored and counterclockwise
  5: (w) => [0, w, 1],
  6: (w, h) => [(h - 1) * w, -w, 1],
  7: (w, h) => [w * h - 1, -w, -1],
  8: (w) => [w - 1, w, -1],
};

// Turns every frame the way the orientation says
export function TurnFrames(
  pixels: Buffer,
  frame: Omit<Frames, 'pixels'>,
  orientation: number | undefined,
): Frames {
  const turn = Turns[orientation ?? 1];
  if (turn === undefined) return { ...frame, pixels };

  const { width, height, channels } = frame;
  const [start, right, down] = turn(width, height);
  const swapped = (orientation ?? 1) >= 5;
  const turned = {
    ...frame,
    pixels: Buffer.alloc(pixels.length),
    width: swapped ? height : width,
    height: swapped ? width : height,
  };

  let to = 0;
  for (let page = 0; page < frame.pages; page++) {
    const first = page * width * height + start;
    for (let y = 0; y < turned.height; y++) {
      let from = first + y * down;
      for (let x = 0; x < turned.width; x++, from += right) {
        for (let c = 0; c < channels; c++) {
          turned.pixels[to++] = pixels[from * channels + c];
        }
      }
    }
  }
  return turned;
}

function IsOpaque(rgba: Buffer): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) return false;
  }
  return true;
}

function WithoutAlpha(rgba: Buffer): Buffer {
  const rgb = Buffer.alloc((rgba.length / 4) * 3);
  for (let from = 0, to = 0; from < rgba.length; from += 4, to += 3) {
    rgb[to] = rgba[from];
    rgb[to + 1] = rgba[from + 1];
    rgb[to + 2] = rgba[from + 2];
  }
  return rgb;
}

export async function UniversalSharpOut(
  image: Sharp,
  filetype: FileType,
  options?: SharpWorkerFinishOptions,
  timing?: AnimationTiming | null,
): Promise<SharpResult> {
  // libvips does not know how an animation plays when it was put together
  // from raw frames
  const animation = timing ? { delay: timing.delay, loop: timing.loop } : {};

  switch (filetype.identifier) {
    case ImageFileType.PNG:
      return image
        .png({ quality: options?.quality })
        .toBuffer({ resolveWithObject: true });
    case ImageFileType.JPEG:
      return image
        .jpeg({ quality: options?.quality })
        .toBuffer({ resolveWithObject: true });
    case ImageFileType.TIFF:
      return image
        .tiff({ quality: options?.quality })
        .toBuffer({ resolveWithObject: true });
    case ImageFileType.AVIF:
      return image
        .avif({ quality: options?.quality })
        .toBuffer({ resolveWithObject: true });
    case ImageFileType.HEIF:
      return image
        .heif({ quality: options?.quality, compression: 'av1' })
        .toBuffer({ resolveWithObject: true });
    case ImageFileType.JXL:
      return image
        .jxl({ quality: options?.quality })
        .toBuffer({ resolveWithObject: true });
    case ImageFileType.JP2:
      return image
        .jp2({ quality: options?.quality })
        .toBuffer({ resolveWithObject: true });
    case ImageFileType.BMP:
      return rawSharpOut(image, BMPencode);
    case ImageFileType.QOI:
      return rawSharpOut(image, QOIencode);
    case ImageFileType.TGA:
      return rawSharpOut(image, TGAencode);
    case ImageFileType.ICO:
      return icoSharpOut(image);
    case ImageFileType.WEBP:
    case AnimFileType.WEBP:
      return image
        .webp({
          quality: options?.quality,
          lossless: options?.lossless,
          effort: options?.effort,
          ...animation,
        })
        .toBuffer({ resolveWithObject: true });
    case AnimFileType.GIF:
      // Choosing the colours of every frame takes most of the time. libvips'
      // default effort of 7 took 4 seconds for 30 frames of a video, and 26
      // for 30 frames of noise. With 4 that is 1.7 and 4 seconds, for files
      // up to 13% larger. Any lower and libimagequant posterizes the colours
      // first, which makes drawings worse and even slower.
      return image
        .gif({ effort: 4, ...animation })
        .toBuffer({ resolveWithObject: true });
    case AnimFileType.APNG:
      return apngSharpOut(image, timing ?? null);
    default:
      throw new Error('Unsupported mime type');
  }
}

// Raw pixels in RGB or RGBA, which is all BMP, QOI and TGA support. Greyscale
// images (with or without alpha) are expanded to colour.
async function rawRGB(sharpImage: Sharp) {
  const raw = await sharpImage
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (raw.info.channels !== 3 && raw.info.channels !== 4) {
    throw new Error(`Unexpected channel count ${raw.info.channels}`);
  }

  return raw as { data: Buffer; info: OutputInfo & { channels: 3 | 4 } };
}

async function rawSharpOut(
  sharpImage: Sharp,
  encode: (
    pixels: Buffer,
    options: { width: number; height: number; channels: 3 | 4 },
  ) => Buffer,
): Promise<SharpResult> {
  const raw = await rawRGB(sharpImage);

  const encoded = encode(raw.data, {
    width: raw.info.width,
    height: raw.info.height,
    channels: raw.info.channels,
  });

  return {
    data: encoded,
    info: raw.info,
  };
}

// Icons are at most 256 pixels wide and high, larger images are made smaller
// to fit. That happens separately, as it would replace a resize asked for.
async function icoSharpOut(sharpImage: Sharp): Promise<SharpResult> {
  const raw = await sharpImage
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const png = await sharp(raw.data, {
    raw: { width: raw.info.width, height: raw.info.height, channels: 4 },
  })
    .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    data: ICOencode([
      { png: png.data, width: png.info.width, height: png.info.height },
    ]),
    info: png.info,
  };
}

// Every frame is written as a PNG by libvips, and put into one APNG
async function apngSharpOut(
  sharpImage: Sharp,
  timing: AnimationTiming | null,
): Promise<SharpResult> {
  // How it plays, from the input when libvips read it as an animation
  const metadata = timing === null ? await sharpImage.metadata() : null;
  const delay = timing?.delay ?? metadata?.delay ?? [];
  const loop = timing?.loop ?? metadata?.loop ?? 0;

  const raw = await sharpImage
    .toColourspace('srgb')
    .ensureAlpha()
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  const { width } = raw.info;
  // After resizing, the page height libvips reports is the one from before
  const pages = raw.info.pages ?? 1;
  const pageHeight = raw.info.height / pages;
  if (!Number.isInteger(pageHeight)) {
    throw new Error('Frames of different heights');
  }

  const frameSize = width * pageHeight * 4;
  const frames: Buffer[] = [];
  for (let page = 0; page < pages; page++) {
    frames.push(
      await sharp(raw.data.subarray(page * frameSize, (page + 1) * frameSize), {
        raw: { width, height: pageHeight, channels: 4 },
      })
        .png()
        .toBuffer(),
    );
  }

  const data = APNGencode(frames, { delays: delay, loop });
  return { data, info: { ...raw.info, format: 'png', size: data.length } };
}
