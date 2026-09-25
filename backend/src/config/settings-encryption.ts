import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
} from 'node:crypto';
import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { AsyncFailable, Fail, FT } from 'picsur-shared/dist/types/failable';
import { EnvPrefix } from './config.static.js';

// Secrets saved on the settings page, like the S3 secret access key, are
// stored encrypted with a key from the environment. The key is never stored
// in the database, so neither the database nor its backups reveal them. It
// can not come from the admin's password: Picsur needs the secrets whenever it
// starts, also when nobody is logged in.
export const EncryptionKeyEnv = `${EnvPrefix}ENCRYPTION_KEY`;

// Marks an encrypted value, and the format it is in:
//   enc:v1:<base64 of salt, iv, authentication tag and encrypted value>
const Prefix = 'enc:v1:';
const SaltLength = 16;
const IvLength = 12;
const TagLength = 16;

// scrypt makes guessing a weak key from a stolen value slow
const ScryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function encryptionKey(): string | undefined {
  const value = process.env[EncryptionKeyEnv]?.trim();
  return value ? value : undefined;
}

export function CanEncryptSettings(): boolean {
  return encryptionKey() !== undefined;
}

export function EncryptionKeyIsShort(): boolean {
  return (encryptionKey()?.length ?? Infinity) < 16;
}

// Deriving a key takes a while on purpose, and the settings are read more
// often than they change, so derived keys are remembered
const derivedKeys = new Map<string, Promise<Buffer>>();

function deriveKey(secret: string, salt: Buffer): Promise<Buffer> {
  const id = `${salt.toString('base64')}:${secret}`;
  let key = derivedKeys.get(id);
  if (key === undefined) {
    if (derivedKeys.size >= 100) derivedKeys.clear();
    key = new Promise((resolve, reject) =>
      scrypt(secret, salt, 32, ScryptOptions, (err, derived) =>
        err ? reject(err) : resolve(derived),
      ),
    );
    derivedKeys.set(id, key);
  }
  return key;
}

export async function EncryptSetting(
  setting: ServerSetting,
  value: string,
): Promise<string> {
  const secret = encryptionKey();
  if (secret === undefined) throw new Error(`${EncryptionKeyEnv} is not set`);

  const salt = randomBytes(SaltLength);
  const iv = randomBytes(IvLength);
  const cipher = createCipheriv(
    'aes-256-gcm',
    await deriveKey(secret, salt),
    iv,
    { authTagLength: TagLength },
  );
  // Ties the value to its setting, so it can not be passed off as another
  cipher.setAAD(Buffer.from(setting));
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);

  return (
    Prefix +
    Buffer.concat([salt, iv, cipher.getAuthTag(), encrypted]).toString('base64')
  );
}

export async function DecryptSetting(
  setting: ServerSetting,
  stored: string,
): AsyncFailable<string> {
  if (!stored.startsWith(Prefix)) {
    return Fail(FT.SysValidation, 'it is not encrypted');
  }
  const secret = encryptionKey();
  if (secret === undefined) {
    return Fail(FT.SysValidation, `${EncryptionKeyEnv} is not set`);
  }

  const raw = Buffer.from(stored.slice(Prefix.length), 'base64');
  if (raw.length < SaltLength + IvLength + TagLength) {
    return Fail(FT.SysValidation, 'it is damaged');
  }
  const salt = raw.subarray(0, SaltLength);
  const iv = raw.subarray(SaltLength, SaltLength + IvLength);
  const tag = raw.subarray(
    SaltLength + IvLength,
    SaltLength + IvLength + TagLength,
  );
  const encrypted = raw.subarray(SaltLength + IvLength + TagLength);

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      await deriveKey(secret, salt),
      iv,
      { authTagLength: TagLength },
    );
    decipher.setAAD(Buffer.from(setting));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return Fail(
      FT.SysValidation,
      `it was saved with another ${EncryptionKeyEnv}, or is damaged`,
    );
  }
}
