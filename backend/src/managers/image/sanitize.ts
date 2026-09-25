import { AnimFileType, ImageFileType } from 'picsur-shared/dist/dto/mimes.dto';
import { ExifOrientation, OrientationOnlyExif } from './exif.js';

// Uploads in formats that browsers show and libvips reads well are kept as
// they are, instead of being converted to a lossless master. For photos that
// master is many times larger than the upload, while holding nothing more
// than it, and converting from it is slower.
//
// Only their metadata is taken out, without touching the image data: camera
// details, locations, comments, thumbnails and anything after the end of the
// image, like the video of a motion photo. Colour profiles stay, and so does
// the orientation of JPEGs, which browsers and conversions both apply.
//
// Returns null for files that can not be kept like this, those are converted
// to a lossless master instead.
export function SanitizeImage(data: Buffer, filetype: string): Buffer | null {
  try {
    switch (filetype) {
      case ImageFileType.JPEG:
        return SanitizeJpeg(data);
      case ImageFileType.PNG:
        return SanitizePng(data, false);
      case AnimFileType.APNG:
        return SanitizePng(data, true);
      case ImageFileType.WEBP:
      case AnimFileType.WEBP:
        return SanitizeWebp(data);
      case AnimFileType.GIF:
        return SanitizeGif(data);
      default:
        return null;
    }
  } catch {
    // Reading past the end of a damaged file
    return null;
  }
}

function startsWith(data: Buffer, text: string): boolean {
  return data.toString('latin1', 0, text.length) === text;
}

// JPEG =======================================================================

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function SanitizeJpeg(data: Buffer): Buffer | null {
  if (data.readUInt16BE(0) !== 0xffd8) return null;

  let jfif: Buffer | null = null;
  let orientation: number | undefined;
  let sawFrame = false;
  let sawScan = false;
  const kept: Buffer[] = [];
  let offset = 2;

  for (;;) {
    // Markers may be padded with any number of 0xff bytes
    if (data[offset] !== 0xff) return null;
    while (data[offset] === 0xff) offset++;
    if (offset >= data.length) return null;
    const marker = data[offset++];

    // End of the image, anything after it is dropped
    if (marker === 0xd9) break;

    // Every other marker expected here has a length
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      return null;
    }
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) return null;
    const payload = data.subarray(offset + 2, offset + length);
    offset += length;

    if (marker === 0xe0) {
      // JFIF, without its thumbnail
      if (startsWith(payload, 'JFIF\0') && payload.length >= 14) {
        jfif = Buffer.concat([payload.subarray(0, 12), Buffer.from([0, 0])]);
      }
    } else if (marker === 0xe1) {
      // EXIF and XMP, only the orientation is kept
      if (startsWith(payload, 'Exif\0\0')) {
        orientation = ExifOrientation(payload.subarray(6));
      }
    } else if (marker === 0xe2) {
      if (startsWith(payload, 'ICC_PROFILE\0'))
        kept.push(jpegSegment(marker, payload));
    } else if (marker === 0xee) {
      // Says how the colours are encoded
      if (startsWith(payload, 'Adobe')) kept.push(jpegSegment(marker, payload));
    } else if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe) {
      // Other application data and comments
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      // Baseline, extended and progressive. Only 8 bit greyscale and colour,
      // which browsers show like libvips does.
      const precision = payload[0];
      const components = payload[5];
      if (precision !== 8 || (components !== 1 && components !== 3)) {
        return null;
      }
      sawFrame = true;
      kept.push(jpegSegment(marker, payload));
    } else if (
      marker === 0xc4 ||
      marker === 0xdb ||
      marker === 0xdd ||
      marker === 0xdc
    ) {
      // Huffman and quantisation tables, restart interval, number of lines
      kept.push(jpegSegment(marker, payload));
    } else if (marker === 0xda) {
      if (!sawFrame) return null;
      sawScan = true;
      kept.push(jpegSegment(marker, payload));

      // The image data runs until the next marker. Inside it 0xff is always
      // followed by a zero byte or a restart marker.
      let end = offset;
      for (;;) {
        end = data.indexOf(0xff, end);
        if (end < 0 || end + 1 >= data.length) return null;
        const next = data[end + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          end += 2;
          continue;
        }
        break;
      }
      kept.push(data.subarray(offset, end));
      offset = end;
    } else {
      // Arithmetic coding, lossless, hierarchical and anything unknown
      return null;
    }
  }

  if (!sawFrame || !sawScan) return null;

  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (jfif !== null) parts.push(jpegSegment(0xe0, jfif));
  if (orientation !== undefined && orientation !== 1) {
    parts.push(
      jpegSegment(
        0xe1,
        Buffer.concat([
          Buffer.from('Exif\0\0', 'latin1'),
          OrientationOnlyExif(orientation),
        ]),
      ),
    );
  }
  parts.push(...kept, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

// PNG ========================================================================

const PngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// Chunks that are part of the image or of how it looks
const PngKeep = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'cICP',
  'mDCV',
  'cLLI',
  'pHYs',
  'bKGD',
]);

// Animations keep the chunks with their frames, still images can not have them
function SanitizePng(data: Buffer, animated: boolean): Buffer | null {
  if (!data.subarray(0, 8).equals(PngSignature)) return null;
  let sawAnimation = false;

  const parts: Buffer[] = [PngSignature];
  let offset = 8;
  for (;;) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > data.length) return null;
    if (offset === 8 && type !== 'IHDR') return null;

    const isAnimation = type === 'acTL' || type === 'fcTL' || type === 'fdAT';
    if (isAnimation && !animated) return null;
    if (isAnimation) sawAnimation = true;
    if (type === 'eXIf') {
      // Only JPEGs keep their orientation, others get it applied
      const orientation = ExifOrientation(
        data.subarray(offset + 8, offset + 8 + length),
      );
      if (orientation !== undefined && orientation !== 1) return null;
    }

    // Chunks are copied as they are, with their checksum
    if (PngKeep.has(type) || isAnimation) {
      parts.push(data.subarray(offset, end));
    }
    offset = end;
    // Anything after the end of the image is dropped
    if (type === 'IEND') {
      return animated && !sawAnimation ? null : Buffer.concat(parts);
    }
  }
}

// WebP =======================================================================

// Chunks that are part of the image, still or animated, or its colours
const WebpKeep = new Set([
  'VP8 ',
  'VP8L',
  'VP8X',
  'ALPH',
  'ANIM',
  'ANMF',
  'ICCP',
]);

// Flags in the extended header that say EXIF and XMP chunks are present
const WebpExifFlag = 0x08;
const WebpXmpFlag = 0x04;

function SanitizeWebp(data: Buffer): Buffer | null {
  if (!startsWith(data, 'RIFF') || data.toString('latin1', 8, 12) !== 'WEBP') {
    return null;
  }
  const riffEnd = 8 + data.readUInt32LE(4);
  if (riffEnd > data.length) return null;

  const chunks: Buffer[] = [];
  let offset = 12;
  while (offset < riffEnd) {
    const type = data.toString('latin1', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const payloadEnd = offset + 8 + size;
    if (payloadEnd > riffEnd) return null;
    const payload = data.subarray(offset + 8, payloadEnd);

    if (type === 'EXIF') {
      // Only JPEGs keep their orientation, others get it applied
      const tiff = startsWith(payload, 'Exif\0\0')
        ? payload.subarray(6)
        : payload;
      const orientation = ExifOrientation(tiff);
      if (orientation !== undefined && orientation !== 1) return null;
    }

    if (WebpKeep.has(type)) {
      const chunk = Buffer.alloc(8 + size + (size & 1));
      data.copy(chunk, 0, offset, payloadEnd);
      if (type === 'VP8X') chunk[8] &= ~(WebpExifFlag | WebpXmpFlag);
      chunks.push(chunk);
    }
    // Chunks are padded to an even length
    offset = payloadEnd + (size & 1);
  }

  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]);
}

// GIF ========================================================================

// Application extensions that say how an animation plays
const GifKeepApplications = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0']);

// Returns where a list of data sub-blocks ends
function gifSubBlocksEnd(data: Buffer, offset: number): number {
  for (;;) {
    const size = data[offset];
    if (size === undefined) throw new RangeError('Unexpected end');
    offset += 1 + size;
    if (size === 0) return offset;
  }
}

function SanitizeGif(data: Buffer): Buffer | null {
  const version = data.toString('latin1', 0, 6);
  if (version !== 'GIF87a' && version !== 'GIF89a') return null;

  // Logical screen descriptor, and the global colour table when it has one
  const flags = data[10];
  let offset = 13;
  if (flags & 0x80) offset += 3 * (1 << ((flags & 0x07) + 1));
  if (offset > data.length) return null;
  const parts: Buffer[] = [data.subarray(0, offset)];

  for (;;) {
    const introducer = data[offset];
    if (introducer === 0x3b) {
      // Trailer, anything after it is dropped
      parts.push(Buffer.from([0x3b]));
      return Buffer.concat(parts);
    } else if (introducer === 0x2c) {
      // Image descriptor, local colour table and the image data
      const imageFlags = data[offset + 9];
      let end = offset + 10;
      if (imageFlags & 0x80) end += 3 * (1 << ((imageFlags & 0x07) + 1));
      // Minimum code size, then the image data
      end = gifSubBlocksEnd(data, end + 1);
      parts.push(data.subarray(offset, end));
      offset = end;
    } else if (introducer === 0x21) {
      const label = data[offset + 1];
      const end = gifSubBlocksEnd(data, offset + 2);
      if (label === 0xf9) {
        // Graphic control, frame timing and transparency
        parts.push(data.subarray(offset, end));
      } else if (label === 0xff) {
        const size = data[offset + 2];
        const application = data.toString(
          'latin1',
          offset + 3,
          offset + 3 + Math.min(size, 11),
        );
        if (GifKeepApplications.has(application)) {
          parts.push(data.subarray(offset, end));
        }
      }
      // Comments, text and other application data are dropped
      offset = end;
    } else {
      return null;
    }
  }
}
