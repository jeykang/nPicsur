import {
  AnimFileType,
  FileType,
  ImageFileType,
} from 'picsur-shared/dist/dto/mimes.dto';
import sharp, { OutputInfo, Sharp, SharpOptions } from 'sharp';
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
}

export async function UniversalSharpIn(
  image: Buffer,
  filetype: FileType,
  options?: SharpOptions,
): Promise<SharpInput> {
  switch (filetype.identifier) {
    case ImageFileType.BMP:
      return still(rawSharpIn(BMPdecode(image), options));
    case ImageFileType.QOI:
      return still(rawSharpIn(QOIdecode(image), options));
    case ImageFileType.TGA:
      return still(rawSharpIn(TGAdecode(image), options));
    case ImageFileType.ICO: {
      const icon = ICOdecode(image);
      return still(
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
      return still(sharp(image, { ...options, autoOrient: true }));
  }
}

function still(image: Sharp): SharpInput {
  return { image, timing: null };
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
  if (!options?.animated) return still(sharp(animation.defaultImage, options));

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
  const frames = IsOpaque(composed) ? WithoutAlpha(composed) : composed;

  return {
    // Still animated, or operations like resizing would only keep the first
    // frame
    image: sharp(frames, {
      ...options,
      raw: {
        width: animation.width,
        height: animation.height * animation.frames.length,
        channels: frames === composed ? 4 : 3,
        pageHeight: animation.height,
      },
    }),
    timing: {
      delay: animation.frames.map((frame) => frame.delay),
      loop: animation.loop,
    },
  };
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
      return image.gif(animation).toBuffer({ resolveWithObject: true });
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
