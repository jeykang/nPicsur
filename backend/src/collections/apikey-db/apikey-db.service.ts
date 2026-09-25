import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { FindResult } from 'picsur-shared/dist/types/find-result';
import { generateRandomString } from 'picsur-shared/dist/util/random';
import { Repository } from 'typeorm';
import { EApiKeyBackend } from '../../database/entities/apikey.entity.js';
import { EUserBackend } from '../../database/entities/users/user.entity.js';

// Api keys are long and random, so a fast hash is enough to keep them from
// being guessed back
export function HashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

@Injectable()
export class ApiKeyDbService {
  private readonly logger = new Logger(ApiKeyDbService.name);

  constructor(
    @InjectRepository(EApiKeyBackend)
    private readonly apikeyRepo: Repository<EApiKeyBackend>,
  ) {}

  // Returns the key itself only this once, only its hash is stored
  async createApiKey(
    userid: string,
  ): AsyncFailable<EApiKeyBackend<string> & { key: string }> {
    const key = generateRandomString(32);

    const apikey = new EApiKeyBackend<string>();
    apikey.user = userid;
    apikey.created = new Date();
    // YYYY-MM-DD- followed by a random number
    apikey.name =
      new Date().toISOString().slice(0, 10) +
      '_' +
      Math.round(Math.random() * 100);
    apikey.key_hash = HashApiKey(key);
    apikey.key_hint = key.slice(-4);

    try {
      const saved = await this.apikeyRepo.save(apikey);
      delete saved.key_hash;
      return { ...saved, key };
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  async findOne(
    id: string,
    userid: string | undefined,
  ): AsyncFailable<EApiKeyBackend<string>> {
    try {
      const apikey = await this.apikeyRepo.findOne({
        where: {
          user:
            userid !== undefined
              ? // This is stupid, but typeorm do typeorm
                ({ id: userid } as any)
              : undefined,
          id,
        },
        loadRelationIds: true,
      });
      if (!apikey) return Fail(FT.NotFound, 'API key not found');
      return apikey as EApiKeyBackend<string>;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  async findMany(
    count: number,
    page: number,
    userid: string | undefined,
  ): AsyncFailable<FindResult<EApiKeyBackend<string>>> {
    if (count < 1 || page < 0) return Fail(FT.UsrValidation, 'Invalid page');
    if (count > 100) return Fail(FT.UsrValidation, 'Too many results');

    try {
      const [apikeys, amount] = await this.apikeyRepo.findAndCount({
        where: {
          user:
            userid !== undefined
              ? // This is stupid, but typeorm do typeorm
                ({ id: userid } as any)
              : undefined,
        },
        order: { created: 'DESC' },
        skip: count * page,
        take: count,
        loadRelationIds: true,
      });

      return {
        results: apikeys as EApiKeyBackend<string>[],
        total: amount,
        page,
        pages: Math.ceil(amount / count),
      };
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  async updateApiKey(
    id: string,
    name: string,
    userid: string | undefined,
  ): AsyncFailable<EApiKeyBackend<string>> {
    const apikey = await this.findOne(id, userid);
    if (HasFailed(apikey)) return apikey;

    try {
      apikey.name = name;

      return this.apikeyRepo.save(apikey);
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  async deleteApiKey(
    id: string,
    userid: string | undefined,
  ): AsyncFailable<EApiKeyBackend<string>> {
    const apikeyToDelete = await this.findOne(id, userid);
    if (HasFailed(apikeyToDelete)) return apikeyToDelete;

    const apiKeyCopy = { ...apikeyToDelete };
    try {
      await this.apikeyRepo.remove(apikeyToDelete);
      return apiKeyCopy as EApiKeyBackend<string>;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  async resolve(key: string): AsyncFailable<EApiKeyBackend<EUserBackend>> {
    try {
      const apikey = await this.apikeyRepo.findOne({
        where: { key_hash: HashApiKey(key) },
        relations: ['user'],
      });
      if (!apikey) return Fail(FT.NotFound, 'API key not found');

      this.updateLastUsed(apikey);

      return apikey as EApiKeyBackend<EUserBackend>;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  private updateLastUsed(apikey: EApiKeyBackend) {
    (async () => {
      apikey.last_used = new Date();
      this.apikeyRepo.save(apikey);
    })().catch(this.logger.error.bind(this.logger));
  }
}
