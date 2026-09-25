import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-strategy';
import { EUser, EUserSchema } from 'picsur-shared/dist/entities/user.entity';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { IsApiKey } from 'picsur-shared/dist/validators/api-key.validator';
import { ApiKeyDbService } from '../../../collections/apikey-db/apikey-db.service.js';
import { EUserBackend2EUser } from '../../../models/transformers/user.transformer.js';

export const ApiKeyPrefix = 'Api-Key ';

// Authenticates requests with an "Authorization: Api-Key <key>" header
class ApiKeyPassportStrategy extends Strategy {
  // Overridden by the nest implementation below
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async validate(apikey: string): Promise<EUser | false> {
    return false;
  }

  override authenticate(req: any) {
    const header = req.headers?.authorization;
    if (typeof header !== 'string' || !header.startsWith(ApiKeyPrefix)) {
      return this.fail(401);
    }

    this.validate(header.slice(ApiKeyPrefix.length))
      .then((user) => (user ? this.success(user) : this.fail(401)))
      .catch((e) => this.error(e));
  }
}

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(
  ApiKeyPassportStrategy,
  'apikey',
) {
  private readonly logger = new Logger(ApiKeyStrategy.name);

  constructor(private readonly apikeyDB: ApiKeyDbService) {
    super();
  }

  override async validate(apikey: string): Promise<EUser | false> {
    if (!IsApiKey().safeParse(apikey).success) {
      this.logger.warn('Invalid apikey format');
      return false;
    }

    const apikeyResult = await this.apikeyDB.resolve(apikey);
    if (HasFailed(apikeyResult)) {
      this.logger.warn('Invalid apikey');
      return false;
    }

    const user = EUserBackend2EUser(apikeyResult.user);

    const userValidation = EUserSchema.safeParse(user);
    if (!userValidation.success) {
      this.logger.error('Invalid user: ' + JSON.stringify(user));
      return false;
    }

    return userValidation.data;
  }
}
