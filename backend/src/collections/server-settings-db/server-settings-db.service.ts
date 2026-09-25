import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  SecretServerSettings,
  ServerSetting,
} from 'picsur-shared/dist/dto/server-settings.dto';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { In, Repository } from 'typeorm';
import {
  ParseStoredServerSettings,
  StoredServerSettings,
  StoredServerSettingValue,
} from '../../config/server-settings.js';
import {
  DecryptSetting,
  EncryptedWithGeneratedKey,
  EncryptSetting,
  NeedsReencryption,
} from '../../config/settings-encryption.js';
import { EServerSettingBackend } from '../../database/entities/system/server-setting.entity.js';

@Injectable()
export class ServerSettingsDbService {
  constructor(
    @InjectRepository(EServerSettingBackend)
    private readonly settingsRepo: Repository<EServerSettingBackend>,
  ) {}

  // Secrets that can not be decrypted are left out
  async getAll(): AsyncFailable<StoredServerSettings> {
    try {
      return await ParseStoredServerSettings(await this.settingsRepo.find());
    } catch (err) {
      return Fail(FT.Database, err);
    }
  }

  // Sets the given settings, or removes them when null, all at once. Secrets
  // are encrypted, which needs the encryption key to be set.
  async update(
    changes: ReadonlyMap<ServerSetting, string | null>,
  ): AsyncFailable<true> {
    const stored = new Map<ServerSetting, string | null>();
    try {
      for (const [key, value] of changes) {
        stored.set(
          key,
          value === null ? null : await StoredServerSettingValue(key, value),
        );
      }
    } catch (err) {
      return Fail(FT.Internal, err);
    }

    try {
      await this.settingsRepo.manager.transaction(async (manager) => {
        for (const [key, value] of stored) {
          if (value === null) {
            await manager.delete(EServerSettingBackend, { key });
          } else {
            await manager.upsert(EServerSettingBackend, { key, value }, [
              'key',
            ]);
          }
        }
      });
      return true;
    } catch (err) {
      return Fail(FT.Database, err);
    }
  }

  // Encrypts saved secrets again with the key new ones are encrypted with,
  // when they were saved with another one that is still around. Also tells
  // whether any secret still needs the generated key.
  async reencryptSecrets(): AsyncFailable<{
    reencrypted: ServerSetting[];
    usesGeneratedKey: boolean;
  }> {
    try {
      const rows = await this.settingsRepo.find({
        where: { key: In(SecretServerSettings) },
      });
      const reencrypted: ServerSetting[] = [];
      let usesGeneratedKey = false;

      for (const row of rows) {
        const key = row.key as ServerSetting;
        if (NeedsReencryption(row.value)) {
          const decrypted = await DecryptSetting(key, row.value);
          if (!HasFailed(decrypted)) {
            const value = await EncryptSetting(key, decrypted.value);
            await this.settingsRepo.update({ key }, { value });
            reencrypted.push(key);
            continue;
          }
        }
        if (EncryptedWithGeneratedKey(row.value)) usesGeneratedKey = true;
      }

      return { reencrypted, usesGeneratedKey };
    } catch (err) {
      return Fail(FT.Database, err);
    }
  }
}
