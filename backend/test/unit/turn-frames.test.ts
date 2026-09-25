import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { TurnFrames } from '../../src/workers/sharp/universal-sharp.js';

describe('turning the frames of animations', () => {
  it('turns every frame like libvips turns a still image', async () => {
    const [width, height, channels, pages] = [5, 3, 3, 2] as const;
    const size = width * height * channels;
    const pixels = randomBytes(size * pages);

    for (let orientation = 1; orientation <= 8; orientation++) {
      const turned = TurnFrames(
        pixels,
        { width, height, channels, pages },
        orientation,
      );
      for (let page = 0; page < pages; page++) {
        // The frame as a still image with the orientation, turned by libvips
        const still = await sharp(
          pixels.subarray(page * size, (page + 1) * size),
          {
            raw: { width, height, channels },
          },
        )
          .webp({ lossless: true })
          .withMetadata({ orientation })
          .toBuffer();
        expect((await sharp(still).metadata()).orientation).toBe(orientation);
        const expected = await sharp(still, { autoOrient: true })
          .raw()
          .toBuffer({ resolveWithObject: true });

        const frame = turned.pixels.subarray(page * size, (page + 1) * size);
        expect(frame.equals(expected.data), `orientation ${orientation}`).toBe(
          true,
        );
        expect([turned.width, turned.height]).toEqual([
          expected.info.width,
          expected.info.height,
        ]);
      }
    }
  });

  it('leaves frames alone without an orientation', async () => {
    const pixels = randomBytes(4 * 4 * 4 * 3);
    const frames = { width: 4, height: 4, channels: 4, pages: 3 } as const;
    for (const orientation of [undefined, 1, 9]) {
      const turned = TurnFrames(pixels, frames, orientation);
      expect(turned.pixels).toBe(pixels);
      expect(turned).toMatchObject(frames);
    }
  });
});
