import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ParseString } from 'picsur-shared/dist/util/parse-simple';
import { EnvPrefix } from '../config.static.js';

@Injectable()
export class EarlyJwtConfigService {
  constructor(private readonly configService: ConfigService) {}

  public getJwtSecret(): string | undefined {
    const secret = ParseString(
      this.configService.get(`${EnvPrefix}JWT_SECRET`),
    );
    return secret?.trim() ? secret : undefined;
  }
}
