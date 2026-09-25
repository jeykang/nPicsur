import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { afterEach, describe, expect, it } from 'vitest';
import { ParseStoredServerSettings } from '../../src/config/server-settings.js';
import {
  CanEncryptSettings,
  DecryptSetting,
  EncryptionKeyEnv,
  EncryptSetting,
} from '../../src/config/settings-encryption.js';

const Secret = ServerSetting.S3SecretAccessKey;
const original = process.env[EncryptionKeyEnv];

function useKey(key: string | undefined) {
  if (key === undefined) delete process.env[EncryptionKeyEnv];
  else process.env[EncryptionKeyEnv] = key;
}

afterEach(() => useKey(original));

describe('settings encryption', () => {
  it('encrypts and decrypts', async () => {
    useKey('a key for the tests, long enough');
    const encrypted = await EncryptSetting(Secret, 'minio-secret');
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(encrypted).not.toContain('minio-secret');
    expect(await DecryptSetting(Secret, encrypted)).toBe('minio-secret');
  });

  it('never encrypts the same way twice', async () => {
    useKey('a key for the tests, long enough');
    const one = await EncryptSetting(Secret, 'minio-secret');
    const two = await EncryptSetting(Secret, 'minio-secret');
    expect(one).not.toBe(two);
  });

  it('needs the key it was encrypted with', async () => {
    useKey('a key for the tests, long enough');
    const encrypted = await EncryptSetting(Secret, 'minio-secret');

    useKey('another key for the tests, long enough');
    const decrypted = await DecryptSetting(Secret, encrypted);
    expect(HasFailed(decrypted)).toBe(true);

    useKey(undefined);
    expect(CanEncryptSettings()).toBe(false);
    expect(HasFailed(await DecryptSetting(Secret, encrypted))).toBe(true);
    await expect(EncryptSetting(Secret, 'minio-secret')).rejects.toThrow(
      EncryptionKeyEnv,
    );
  });

  it('only decrypts a value as the setting it was saved as', async () => {
    useKey('a key for the tests, long enough');
    const encrypted = await EncryptSetting(Secret, 'minio-secret');
    const moved = await DecryptSetting(ServerSetting.S3AccessKeyId, encrypted);
    expect(HasFailed(moved)).toBe(true);
  });

  it('notices changed values', async () => {
    useKey('a key for the tests, long enough');
    const encrypted = await EncryptSetting(Secret, 'minio-secret');
    const raw = Buffer.from(encrypted.slice('enc:v1:'.length), 'base64');
    raw[raw.length - 1] ^= 1;
    const changed = 'enc:v1:' + raw.toString('base64');
    expect(HasFailed(await DecryptSetting(Secret, changed))).toBe(true);
    expect(HasFailed(await DecryptSetting(Secret, 'enc:v1:AAAA'))).toBe(true);
  });

  it('leaves out secrets that are not encrypted or can not be read', async () => {
    useKey('a key for the tests, long enough');
    const ignored: string[] = [];
    const settings = await ParseStoredServerSettings(
      [
        { key: 's3_bucket', value: 'picsur' },
        { key: 's3_secret_access_key', value: 'plain-text' },
        { key: 'max_file_size', value: 'lots' },
        { key: 'not_a_setting', value: 'anything' },
      ],
      (key) => ignored.push(key),
    );
    expect([...settings]).toEqual([[ServerSetting.S3Bucket, 'picsur']]);
    expect(ignored).toEqual(['s3_secret_access_key', 'max_file_size']);

    const encrypted = await EncryptSetting(Secret, 'minio-secret');
    const read = await ParseStoredServerSettings([
      { key: 's3_secret_access_key', value: encrypted },
    ]);
    expect(read.get(Secret)).toBe('minio-secret');
  });
});
