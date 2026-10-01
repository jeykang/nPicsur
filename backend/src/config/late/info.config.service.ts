import { Injectable } from '@nestjs/common';
import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { GetServerSettingOrDefault } from '../server-settings.js';

@Injectable()
export class InfoConfigService {
  // The address Picsur is reached at, for links to images, when it is set
  public getHostnameOverride(): string | undefined {
    return GetServerSettingOrDefault(ServerSetting.HostOverride) ?? undefined;
  }
}
