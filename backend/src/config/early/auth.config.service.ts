import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ParseString } from 'picsur-shared/dist/util/parse-simple';
import { EnvPrefix } from '../config.static.js';

@Injectable()
export class AuthConfigService {
  constructor(private readonly configService: ConfigService) {}

  // Only used when the admin user is created, returns undefined when not set
  public getDefaultAdminPassword(): string | undefined {
    return (
      ParseString(this.configService.get(`${EnvPrefix}ADMIN_PASSWORD`)) ??
      undefined
    );
  }
}
