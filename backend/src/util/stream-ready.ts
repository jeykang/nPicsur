import type { Readable } from 'node:stream';
import { AsyncFailable, Fail, FT } from 'picsur-shared/dist/types/failable';

// Resolves once a stream has data, or has reached its end. Nothing is sent
// before then, so a stream that fails right away, like when the connection to
// the bucket breaks, is still answered like any other failure.
export function StreamReady(stream: Readable): AsyncFailable<true> {
  return new Promise((resolve) => {
    const finish = (error?: Error) => {
      stream.off('readable', onReadable);
      stream.off('error', finish);
      if (error === undefined) return resolve(true);
      stream.destroy();
      resolve(
        Fail(
          FT.Internal,
          'Could not load image',
          error instanceof Error ? error.message : String(error),
        ),
      );
    };
    const onReadable = () => finish();

    if (stream.errored !== null) return finish(stream.errored);
    stream.once('readable', onReadable);
    stream.once('error', finish);
  });
}
