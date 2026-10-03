import type { IncomingHttpHeaders } from 'node:http';

// Entity tags in If-None-Match, which may contain commas themselves
const EntityTag = /(?:W\/)?"[^"]*"/g;

// Whether the copy a client already has is still the current one, so it can
// be answered with 304 Not Modified (RFC 9110, section 13.2.2). Only for
// representations that exist.
export function IsNotModified(
  headers: IncomingHttpHeaders,
  etag: string,
  lastModified: Date,
): boolean {
  const ifNoneMatch = headers['if-none-match'];
  if (ifNoneMatch !== undefined) {
    if (ifNoneMatch.trim() === '*') return true;
    // Weak comparison: W/"a" matches "a"
    const opaque = (tag: string) => tag.replace(/^W\//, '');
    return (ifNoneMatch.match(EntityTag) ?? []).some(
      (tag) => opaque(tag) === opaque(etag),
    );
  }

  // Only when there is no If-None-Match
  const ifModifiedSince = headers['if-modified-since'];
  if (ifModifiedSince !== undefined) {
    const since = Date.parse(ifModifiedSince);
    if (Number.isNaN(since)) return false;
    // Dates in headers are in whole seconds
    return Math.floor(lastModified.getTime() / 1000) * 1000 <= since;
  }

  return false;
}
