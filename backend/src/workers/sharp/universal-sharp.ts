import {
  AnimFileType,
  FileType,
  ImageFileType,
} from 'picsur-shared/dist/dto/mimes.dto';
import sharp, { OutputInfo, Sharp, SharpOptions } from 'sharp';
import { BMPdecode, BMPencode } from '../codecs/bmp.js';
import { QOIdecode, QOIencode } from '../codecs/qoi.js';
import { SharpWorkerFinishOptions } from './sharp.message.js';

export interface SharpResult {
  data: Buffer;
  info: OutputInfo;
}

export function UniversalSharpIn(
  image: Buffer,
  filetype: FileType,
  options?: SharpOptions,
): Sharp {
  // if (mime.mime === ImageFileType.ICO) {
  //   return icoSharpIn(image, options);
  // } else
  if (filetype.identifier === ImageFileType.BMP) {
    return bmpSharpIn(image, options);
  } else if (filetype.identifier === ImageFileType.QOI) {
    return qoiSharpIn(image, options);
  } else {
    return sharp(image, options);
  }
}

function bmpSharpIn(image: Buffer, options?: SharpOptions) {
  const bitmap = BMPdecode(image);
  return sharp(bitmap.pixels, {
    ...options,
    raw: {
      width: bitmap.width,
      height: bitmap.height,
      channels: bitmap.channels,
    },
  });
}

// function icoSharpIn(image: Buffer, options?: SharpOptions) {
//   const result = decodeico(image);
//   // Get biggest image
//   const best = result.sort((a, b) => b.width - a.width)[0];

//   return sharp(best.data, {
//     ...options,
//     raw: {
//       width: best.width,
//       height: best.height,
//       channels: 4,
//     },
//   });
// }

function qoiSharpIn(image: Buffer, options?: SharpOptions) {
  const result = QOIdecode(image);

  return sharp(result.pixels, {
    ...options,
    raw: {
      width: result.width,
      height: result.height,
      channels: result.channels,
    },
  });
}

export async function UniversalSharpOut(
  image: Sharp,
  filetype: FileType,
  options?: SharpWorkerFinishOptions,
): Promise<SharpResult> {
  let result: SharpResult | undefined;

  switch (filetype.identifier) {
    case ImageFileType.PNG:
      result = await image
        .png({ quality: options?.quality })
        .toBuffer({ resolveWithObject: true });
      break;
    case ImageFileType.JPEG:
      result = await image
        .jpeg({ quality: options?.quality })
        .toBuffer({ resolveWithObject: true });
      break;
    case ImageFileType.TIFF:
      result = await image
        .tiff({ quality: options?.quality })
        .toBuffer({ resolveWithObject: true });
      break;
    case ImageFileType.AVIF:
      result = await image
        .avif({ quality: options?.quality })
        .toBuffer({ resolveWithObject: true });
      break;
    case ImageFileType.HEIF:
      result = await image
        .heif({ quality: options?.quality, compression: 'av1' })
        .toBuffer({ resolveWithObject: true });
      break;
    case ImageFileType.JXL:
      result = await image
        .jxl({ quality: options?.quality })
        .toBuffer({ resolveWithObject: true });
      break;
    case ImageFileType.JP2:
      result = await image
        .jp2({ quality: options?.quality })
        .toBuffer({ resolveWithObject: true });
      break;
    case ImageFileType.BMP:
      result = await bmpSharpOut(image);
      break;
    case ImageFileType.QOI:
      result = await qoiSharpOut(image);
      break;
    case ImageFileType.WEBP:
    case AnimFileType.WEBP:
      result = await image
        .webp({
          quality: options?.quality,
          lossless: options?.lossless,
          effort: options?.effort,
        })
        .toBuffer({ resolveWithObject: true });
      break;
    case AnimFileType.GIF:
      result = await image.gif().toBuffer({ resolveWithObject: true });
      break;
    default:
      throw new Error('Unsupported mime type');
  }

  return result;
}

// Raw pixels in RGB or RGBA, which is all BMP and QOI support. Greyscale
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

async function bmpSharpOut(sharpImage: Sharp): Promise<SharpResult> {
  const raw = await rawRGB(sharpImage);

  const encoded = BMPencode(raw.data, {
    width: raw.info.width,
    height: raw.info.height,
    channels: raw.info.channels,
  });

  return {
    data: encoded,
    info: raw.info,
  };
}

async function qoiSharpOut(sharpImage: Sharp): Promise<SharpResult> {
  const raw = await rawRGB(sharpImage);

  const encoded = QOIencode(raw.data, {
    width: raw.info.width,
    height: raw.info.height,
    channels: raw.info.channels,
  });

  return {
    data: encoded,
    info: raw.info,
  };
}
