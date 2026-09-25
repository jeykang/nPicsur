import { crc32 } from 'node:zlib';
import { AnimFileType, ImageFileType } from 'picsur-shared/dist/dto/mimes.dto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MasterDimensions } from '../../src/managers/image/dimensions.js';
import { ExifOrientation } from '../../src/managers/image/exif.js';
import { SanitizeImage } from '../../src/managers/image/sanitize.js';
import { makeAnimatedGif } from '../e2e/helpers/images.js';

const Secret = 'Somewhere secret';
const Xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>${Secret}</dc:description></rdf:Description></rdf:RDF></x:xmpmeta>`;
const Exif = {
  IFD0: { ImageDescription: Secret, Make: 'Phone' },
  IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 22/1 0/1' },
};

async function photo(width = 60, height = 40) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#000',
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  })
    .png()
    .toBuffer();
}

// Decoded pixels, which have to stay exactly the same
async function pixels(image: Buffer, animated = false) {
  return sharp(image, { animated }).raw().toBuffer();
}

function expectNoSecrets(data: Buffer) {
  expect(data.includes(Secret)).toBe(false);
  expect(data.includes('Phone')).toBe(false);
}

function jpegSegment(marker: number, payload: Buffer) {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function pngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

describe('keeping uploads as they are', () => {
  it('takes the metadata out of JPEGs, and nothing else', async () => {
    const original = await sharp(await photo())
      .jpeg({ quality: 90 })
      .withExif(Exif)
      .withXmp(Xmp)
      .withIccProfile('p3')
      .toBuffer();
    // A comment, and a video after the end like motion photos have
    const withExtras = Buffer.concat([
      original.subarray(0, 2),
      jpegSegment(0xfe, Buffer.from(Secret)),
      original.subarray(2),
      Buffer.from(`video: ${Secret}`),
    ]);
    expect(withExtras.includes(Secret)).toBe(true);

    const kept = SanitizeImage(withExtras, ImageFileType.JPEG);
    if (kept === null) throw new Error('Not kept');
    expectNoSecrets(kept);
    expect(kept.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    expect(await pixels(kept)).toEqual(await pixels(original));

    const metadata = await sharp(kept).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    // The colour profile stays
    expect(metadata.icc).toBeDefined();
  });

  it('keeps only the orientation of a JPEG, which is still applied', async () => {
    const original = await sharp(await photo(60, 40))
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge(Exif)
      .toBuffer();
    expect((await sharp(original).metadata()).orientation).toBe(6);

    const kept = SanitizeImage(original, ImageFileType.JPEG);
    if (kept === null) throw new Error('Not kept');
    expectNoSecrets(kept);

    const metadata = await sharp(kept).metadata();
    expect(metadata.orientation).toBe(6);
    const shown = await sharp(kept, { autoOrient: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([shown.info.width, shown.info.height]).toEqual([40, 60]);
    expect(MasterDimensions(kept)).toEqual({ width: 40, height: 60 });
  });

  it('keeps progressive JPEGs', async () => {
    const original = await sharp(await photo(300, 200))
      .jpeg({ progressive: true })
      .withExif(Exif)
      .toBuffer();
    const kept = SanitizeImage(original, ImageFileType.JPEG);
    if (kept === null) throw new Error('Not kept');
    expectNoSecrets(kept);
    expect(await pixels(kept)).toEqual(await pixels(original));
  });

  it('converts JPEGs that browsers might show differently', async () => {
    const cmyk = await sharp(await photo())
      .toColourspace('cmyk')
      .jpeg()
      .toBuffer();
    expect(SanitizeImage(cmyk, ImageFileType.JPEG)).toBeNull();

    const jpeg = await sharp(await photo())
      .jpeg()
      .toBuffer();
    expect(SanitizeImage(jpeg.subarray(0, 300), ImageFileType.JPEG)).toBeNull();
    expect(SanitizeImage(Buffer.from('nope'), ImageFileType.JPEG)).toBeNull();
  });

  it('takes the metadata out of PNGs', async () => {
    const original = await sharp(await photo())
      .png()
      .withIccProfile('p3')
      .toBuffer();
    const iend = original.length - 12;
    const withText = Buffer.concat([
      original.subarray(0, iend),
      pngChunk('tEXt', Buffer.from(`Comment\0${Secret}`)),
      pngChunk('tIME', Buffer.alloc(7)),
      original.subarray(iend),
      Buffer.from(Secret),
    ]);

    const kept = SanitizeImage(withText, ImageFileType.PNG);
    if (kept === null) throw new Error('Not kept');
    expect(kept.includes(Secret)).toBe(false);
    expect(kept.includes('tIME')).toBe(false);
    expect(kept.includes('iCCP')).toBe(true);
    expect(await pixels(kept)).toEqual(await pixels(original));
    expect(MasterDimensions(kept)).toEqual({ width: 60, height: 40 });
  });

  it('converts PNGs that need turning, and animated ones', async () => {
    const png = await sharp(await photo())
      .png()
      .toBuffer();
    const exif = Buffer.from(
      await sharp(await photo())
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer()
        .then((jpeg) => sharp(jpeg).metadata())
        .then((metadata) => metadata.exif!.subarray(6)),
    );
    expect(ExifOrientation(exif)).toBe(6);
    const turned = Buffer.concat([
      png.subarray(0, 33),
      pngChunk('eXIf', exif),
      png.subarray(33),
    ]);
    expect(SanitizeImage(turned, ImageFileType.PNG)).toBeNull();

    const animated = Buffer.concat([
      png.subarray(0, 33),
      pngChunk('acTL', Buffer.alloc(8)),
      png.subarray(33),
    ]);
    expect(SanitizeImage(animated, ImageFileType.PNG)).toBeNull();
  });

  it('takes the metadata out of WebPs, still and animated', async () => {
    const still = await sharp(await photo())
      .webp()
      .withExif(Exif)
      .withXmp(Xmp)
      .withIccProfile('p3')
      .toBuffer();
    expect(still.includes(Secret)).toBe(true);

    const kept = SanitizeImage(still, ImageFileType.WEBP);
    if (kept === null) throw new Error('Not kept');
    expectNoSecrets(kept);
    const metadata = await sharp(kept).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.icc).toBeDefined();
    expect(await pixels(kept)).toEqual(await pixels(still));

    const animated = await sharp(makeAnimatedGif(3), { animated: true })
      .webp()
      .withExif(Exif)
      .toBuffer();
    const keptAnimation = SanitizeImage(animated, AnimFileType.WEBP);
    if (keptAnimation === null) throw new Error('Not kept');
    expectNoSecrets(keptAnimation);
    expect((await sharp(keptAnimation).metadata()).pages).toBe(3);
    expect(await pixels(keptAnimation, true)).toEqual(
      await pixels(animated, true),
    );
  });

  it('takes comments and application data out of GIFs', async () => {
    const gif = makeAnimatedGif(3);
    const comment = Buffer.concat([
      Buffer.from([0x21, 0xfe, Secret.length]),
      Buffer.from(Secret),
      Buffer.from([0]),
    ]);
    const xmp = Buffer.concat([
      Buffer.from([0x21, 0xff, 11]),
      Buffer.from('XMP DataXMP'),
      Buffer.from([Secret.length]),
      Buffer.from(Secret),
      Buffer.from([0]),
    ]);
    const withExtras = Buffer.concat([
      gif.subarray(0, gif.length - 1),
      comment,
      xmp,
      gif.subarray(gif.length - 1),
      Buffer.from(Secret),
    ]);

    const kept = SanitizeImage(withExtras, AnimFileType.GIF);
    if (kept === null) throw new Error('Not kept');
    expect(kept.includes(Secret)).toBe(false);
    expect((await sharp(kept).metadata()).pages).toBe(3);
    expect(await pixels(kept, true)).toEqual(await pixels(gif, true));
    expect(MasterDimensions(kept)).toEqual({ width: 32, height: 32 });
  });

  it('converts other formats', async () => {
    const tiff = await sharp(await photo())
      .tiff()
      .toBuffer();
    expect(SanitizeImage(tiff, ImageFileType.TIFF)).toBeNull();
  });
});
