import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { afterEach, describe, expect, it } from 'vitest';
import { ParseStoredServerSettings } from '../../src/config/server-settings.js';
import {
  DecryptSetting,
  EncryptedWithGeneratedKey,
  EncryptionKeyEnv,
  EncryptionKeySource,
  EncryptSetting,
  NeedsReencryption,
  NewEncryptionKey,
  UseGeneratedEncryptionKey,
} from '../../src/config/settings-encryption.js';

const Secret = ServerSetting.S3SecretAccessKey;
const original = process.env[EncryptionKeyEnv];

function useKeys(keys: { env?: string; generated?: string }) {
  if (keys.env === undefined) delete process.env[EncryptionKeyEnv];
  else process.env[EncryptionKeyEnv] = keys.env;
  UseGeneratedEncryptionKey(keys.generated ?? null);
}

afterEach(() => {
  if (original === undefined) delete process.env[EncryptionKeyEnv];
  else process.env[EncryptionKeyEnv] = original;
  UseGeneratedEncryptionKey(null);
});

describe('settings encryption', () => {
  it('uses the generated key without PICSUR_ENCRYPTION_KEY', async () => {
    useKeys({ generated: NewEncryptionKey() });
    expect(EncryptionKeySource()).toBe('database');

    const encrypted = await EncryptSetting(Secret, 'minio-secret');
    expect(encrypted.startsWith('enc:v1:db:')).toBe(true);
    expect(encrypted).not.toContain('minio-secret');
    expect(await DecryptSetting(Secret, encrypted)).toEqual({
      value: 'minio-secret',
      source: 'database',
    });
  });

  it('prefers PICSUR_ENCRYPTION_KEY', async () => {
    useKeys({ env: 'a key for the tests', generated: NewEncryptionKey() });
    expect(EncryptionKeySource()).toBe('environment');

    const encrypted = await EncryptSetting(Secret, 'minio-secret');
    expect(encrypted.startsWith('enc:v1:env:')).toBe(true);
    expect(await DecryptSetting(Secret, encrypted)).toEqual({
      value: 'minio-secret',
      source: 'environment',
    });
    expect(NeedsReencryption(encrypted)).toBe(false);
  });

  it('can move values from the generated key to PICSUR_ENCRYPTION_KEY', async () => {
    const generated = NewEncryptionKey();
    useKeys({ generated });
    const old = await EncryptSetting(Secret, 'minio-secret');
    expect(EncryptedWithGeneratedKey(old)).toBe(true);
    expect(NeedsReencryption(old)).toBe(false);

    useKeys({ env: 'a key for the tests', generated });
    expect(NeedsReencryption(old)).toBe(true);
    const decrypted = await DecryptSetting(Secret, old);
    if (HasFailed(decrypted)) throw decrypted;
    const moved = await EncryptSetting(Secret, decrypted.value);
    expect(EncryptedWithGeneratedKey(moved)).toBe(false);

    // Without the generated key, only the moved value can be read
    useKeys({ env: 'a key for the tests' });
    expect(HasFailed(await DecryptSetting(Secret, old))).toBe(true);
    expect(await DecryptSetting(Secret, moved)).toEqual({
      value: 'minio-secret',
      source: 'environment',
    });
  });

  it('never encrypts the same way twice', async () => {
    useKeys({ generated: NewEncryptionKey() });
    const one = await EncryptSetting(Secret, 'minio-secret');
    const two = await EncryptSetting(Secret, 'minio-secret');
    expect(one).not.toBe(two);
  });

  it('needs the key it was encrypted with', async () => {
    useKeys({ env: 'a key for the tests' });
    const encrypted = await EncryptSetting(Secret, 'minio-secret');

    useKeys({ env: 'another key for the tests' });
    const wrong = await DecryptSetting(Secret, encrypted);
    expect(HasFailed(wrong) && wrong.getReason()).toContain(
      `another ${EncryptionKeyEnv}`,
    );

    useKeys({ generated: NewEncryptionKey() });
    const missing = await DecryptSetting(Secret, encrypted);
    expect(HasFailed(missing) && missing.getReason()).toContain(
      `${EncryptionKeyEnv}, which is not set`,
    );

    useKeys({});
    expect(EncryptionKeySource()).toBeNull();
    await expect(EncryptSetting(Secret, 'minio-secret')).rejects.toThrow(
      'no key',
    );
  });

  it('only decrypts a value as the setting it was saved as', async () => {
    useKeys({ generated: NewEncryptionKey() });
    const encrypted = await EncryptSetting(Secret, 'minio-secret');
    const moved = await DecryptSetting(ServerSetting.S3AccessKeyId, encrypted);
    expect(HasFailed(moved)).toBe(true);
  });

  it('notices changed values', async () => {
    useKeys({ generated: NewEncryptionKey() });
    const encrypted = await EncryptSetting(Secret, 'minio-secret');
    const prefix = 'enc:v1:db:';
    const raw = Buffer.from(encrypted.slice(prefix.length), 'base64');
    raw[raw.length - 1] ^= 1;
    const changed = prefix + raw.toString('base64');
    expect(HasFailed(await DecryptSetting(Secret, changed))).toBe(true);
    expect(HasFailed(await DecryptSetting(Secret, 'enc:v1:db:AAAA'))).toBe(
      true,
    );
    expect(HasFailed(await DecryptSetting(Secret, 'enc:v9:xx:AAAA'))).toBe(
      true,
    );
  });

  it('leaves out secrets that are not encrypted or can not be read', async () => {
    useKeys({ generated: NewEncryptionKey() });
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
