import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MasterDimensions } from '../../src/managers/image/dimensions.js';
import { IsAnimatedWebP } from '../../src/managers/image/webp.js';
import { QOIencode } from '../../src/workers/codecs/qoi.js';
import { makeAnimatedGif, makePng } from '../e2e/helpers/images.js';

describe('IsAnimatedWebP', () => {
  it('recognises animated images', async () => {
    const animated = await sharp(makeAnimatedGif(3), { animated: true })
      .webp()
      .toBuffer();
    expect(IsAnimatedWebP(animated)).toBe(true);
  });

  it('recognises still images, lossy, lossless and with alpha', async () => {
    const png = await makePng();
    for (const options of [{}, { lossless: true }, { alphaQuality: 50 }]) {
      const still = await sharp(png).webp(options).toBuffer();
      expect(IsAnimatedWebP(still)).toBe(false);
    }
    // A single frame "animation" is written as a still image
    const single = await sharp(makeAnimatedGif(1), { animated: true })
      .webp()
      .toBuffer();
    expect(IsAnimatedWebP(single)).toBe(false);
  });

  it('ignores anything that is not a webp', async () => {
    expect(IsAnimatedWebP(Buffer.alloc(0))).toBe(false);
    expect(IsAnimatedWebP(await makePng())).toBe(false);
    expect(IsAnimatedWebP(makeAnimatedGif(3))).toBe(false);
  });
});

describe('MasterDimensions', () => {
  it('reads the size of QOI and every kind of WebP', async () => {
    const png = await makePng(37, 23);
    const qoi = QOIencode(await sharp(png).raw().toBuffer(), {
      width: 37,
      height: 23,
      channels: 4,
    });
    const images = [
      qoi,
      await sharp(png).webp().toBuffer(),
      await sharp(png).webp({ lossless: true }).toBuffer(),
      await sharp(png).flatten().webp().toBuffer(),
    ];
    for (const image of images) {
      expect(MasterDimensions(image)).toEqual({ width: 37, height: 23 });
    }

    const animated = await sharp(makeAnimatedGif(3, 17, 11), { animated: true })
      .webp()
      .toBuffer();
    expect(MasterDimensions(animated)).toEqual({ width: 17, height: 11 });
  });

  it('gives up on other formats', async () => {
    expect(MasterDimensions(await makePng())).toBeNull();
    expect(MasterDimensions(Buffer.alloc(40))).toBeNull();
  });
});
