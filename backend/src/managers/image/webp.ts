// Just enough of the WebP container format (RFC 9649) to tell animated and
// still images apart.

// RIFF header, "WEBP", then the first chunk's fourcc, its size, and for the
// extended format the flags byte
const MIN_SIZE = 21;
const ANIMATION_FLAG = 0x02;

export function IsAnimatedWebP(data: Buffer): boolean {
  if (data.length < MIN_SIZE) return false;
  if (
    data.toString('latin1', 0, 4) !== 'RIFF' ||
    data.toString('latin1', 8, 12) !== 'WEBP'
  ) {
    return false;
  }

  // Only the extended format can hold an animation, and it always starts with
  // a VP8X chunk
  if (data.toString('latin1', 12, 16) !== 'VP8X') return false;
  return (data[20] & ANIMATION_FLAG) !== 0;
}
