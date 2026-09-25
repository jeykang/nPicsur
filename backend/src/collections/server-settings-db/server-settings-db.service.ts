import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { AsyncFailable, Fail, FT } from 'picsur-shared/dist/types/failable';
import { Repository } from 'typeorm';
import {
  ParseStoredServerSettings,
  StoredServerSettings,
  StoredServerSettingValue,
} from '../../config/server-settings.js';
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
}
