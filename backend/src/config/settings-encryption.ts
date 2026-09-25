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
// stored encrypted. The key comes from PICSUR_ENCRYPTION_KEY when it is set,
// and is then not stored anywhere, so neither the database nor its backups
// reveal the secrets. Otherwise Picsur generates a key and keeps it in the
// database, which keeps the secrets out of sight, but not from someone with a
// copy of the database. The key can not come from the admin's password:
// Picsur needs the secrets whenever it starts, also when nobody is logged in.
export const EncryptionKeyEnv = `${EnvPrefix}ENCRYPTION_KEY`;

// Name of the generated key in the system state table
export const GeneratedKeyState = 'settings_encryption_key';

export type EncryptionKeySource = 'environment' | 'database';

// Encrypted values look like this, with the key they were encrypted with:
//   enc:v1:env:<base64 of salt, iv, authentication tag and value>
//   enc:v1:db:<the same>
// The AES-256-GCM key is derived from the key and the salt with scrypt, and
// the name of the setting is the additional authenticated data.
const Prefix = 'enc:v1:';
const SourceTags: Record<EncryptionKeySource, string> = {
  environment: 'env',
  database: 'db',
};
const SaltLength = 16;
const IvLength = 12;
const TagLength = 16;

// scrypt makes guessing a weak key from a stolen value slow
const ScryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// The generated key, loaded from the database, or created when missing
let generatedKey: string | null = null;

export function UseGeneratedEncryptionKey(key: string | null) {
  generatedKey = key;
}

export function GeneratedEncryptionKey(): string | null {
  return generatedKey;
}

export function NewEncryptionKey(): string {
  return randomBytes(32).toString('base64');
}

function environmentKey(): string | undefined {
  const value = process.env[EncryptionKeyEnv]?.trim();
  return value ? value : undefined;
}

function keyFrom(source: EncryptionKeySource): string | undefined {
  return source === 'environment'
    ? environmentKey()
    : (generatedKey ?? undefined);
}

// Where the key new secrets are encrypted with comes from, null when there is
// none yet
export function EncryptionKeySource(): EncryptionKeySource | null {
  if (environmentKey() !== undefined) return 'environment';
  if (generatedKey !== null) return 'database';
  return null;
}

export function EncryptionKeyIsShort(): boolean {
  return (environmentKey()?.length ?? Infinity) < 16;
}

// Whether a stored value was encrypted with another key than the one new
// secrets are encrypted with, like after PICSUR_ENCRYPTION_KEY was set
export function NeedsReencryption(stored: string): boolean {
  const source = EncryptionKeySource();
  return (
    source !== null &&
    stored.startsWith(Prefix) &&
    !stored.startsWith(`${Prefix}${SourceTags[source]}:`)
  );
}

export function EncryptedWithGeneratedKey(stored: string): boolean {
  return stored.startsWith(`${Prefix}${SourceTags.database}:`);
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
  const source = EncryptionKeySource();
  const secret = source === null ? undefined : keyFrom(source);
  if (source === null || secret === undefined) {
    throw new Error('There is no key to encrypt secrets with');
  }

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
    `${Prefix}${SourceTags[source]}:` +
    Buffer.concat([salt, iv, cipher.getAuthTag(), encrypted]).toString('base64')
  );
}

export async function DecryptSetting(
  setting: ServerSetting,
  stored: string,
): AsyncFailable<{ value: string; source: EncryptionKeySource }> {
  if (!stored.startsWith(Prefix)) {
    return Fail(FT.SysValidation, 'it is not encrypted');
  }
  const rest = stored.slice(Prefix.length);
  const separator = rest.indexOf(':');
  const tag = rest.slice(0, separator);
  const source = (Object.keys(SourceTags) as EncryptionKeySource[]).find(
    (candidate) => SourceTags[candidate] === tag,
  );
  if (separator < 0 || source === undefined) {
    return Fail(
      FT.SysValidation,
      'it is encrypted in a way Picsur does not know',
    );
  }

  const secret = keyFrom(source);
  if (secret === undefined) {
    return Fail(
      FT.SysValidation,
      source === 'environment'
        ? `it was saved with ${EncryptionKeyEnv}, which is not set`
        : 'the generated key it was saved with is gone from the database',
    );
  }

  const raw = Buffer.from(rest.slice(separator + 1), 'base64');
  if (raw.length < SaltLength + IvLength + TagLength) {
    return Fail(FT.SysValidation, 'it is damaged');
  }
  const salt = raw.subarray(0, SaltLength);
  const iv = raw.subarray(SaltLength, SaltLength + IvLength);
  const authTag = raw.subarray(
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
    decipher.setAuthTag(authTag);
    const value = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
    return { value, source };
  } catch {
    return Fail(
      FT.SysValidation,
      source === 'environment'
        ? `it was saved with another ${EncryptionKeyEnv}, or is damaged`
        : 'it does not match the generated key in the database, or is damaged',
    );
  }
}
