import { describe, expect, it } from 'vitest';
import { IsNotModified } from '../../src/util/not-modified.js';

const Etag = 'W/"abc-123"';
const LastModified = new Date('2026-10-01T12:00:00.750Z');

describe('telling whether a client has the current image', () => {
  it('compares entity tags weakly', () => {
    for (const ifNoneMatch of [
      'W/"abc-123"',
      '"abc-123"',
      '"other", W/"abc-123"',
      '"other",W/"abc-123" , "more"',
    ]) {
      expect(
        IsNotModified({ 'if-none-match': ifNoneMatch }, Etag, LastModified),
        ifNoneMatch,
      ).toBe(true);
    }
    expect(
      IsNotModified(
        { 'if-none-match': '"abc-123"' },
        '"abc-123"',
        LastModified,
      ),
    ).toBe(true);
  });

  it('does not match other entity tags', () => {
    for (const ifNoneMatch of [
      '"abc-12"',
      'W/"abc-1234"',
      'abc-123',
      '"abc-123,other"',
      '',
    ]) {
      expect(
        IsNotModified({ 'if-none-match': ifNoneMatch }, Etag, LastModified),
        ifNoneMatch,
      ).toBe(false);
    }
  });

  it('matches anything with a star', () => {
    expect(IsNotModified({ 'if-none-match': ' * ' }, Etag, LastModified)).toBe(
      true,
    );
  });

  it('compares dates in whole seconds', () => {
    const at = (date: string) =>
      IsNotModified({ 'if-modified-since': date }, Etag, LastModified);
    expect(at(LastModified.toUTCString())).toBe(true);
    expect(at('Thu, 01 Oct 2026 12:00:01 GMT')).toBe(true);
    expect(at('Thu, 01 Oct 2026 11:59:59 GMT')).toBe(false);
    expect(at('not a date')).toBe(false);
  });

  it('ignores the date when there are entity tags', () => {
    expect(
      IsNotModified(
        {
          'if-none-match': '"other"',
          'if-modified-since': LastModified.toUTCString(),
        },
        Etag,
        LastModified,
      ),
    ).toBe(false);
  });

  it('sends the image without either', () => {
    expect(IsNotModified({}, Etag, LastModified)).toBe(false);
  });
});
