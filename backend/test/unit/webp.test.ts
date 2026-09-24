import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { IsAnimatedWebP } from '../../src/managers/image/webp.js';
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
