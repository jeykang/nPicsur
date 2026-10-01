import { Injectable } from '@nestjs/common';
import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { GetServerSettingOrDefault } from '../server-settings.js';

// Counting visits with Ackee, which needs both its address and the id of the
// website there
@Injectable()
export class UsageConfigService {
  getTrackingUrl(): string | null {
    return this.tracking()?.url ?? null;
  }

  getTrackingID(): string | null {
    return this.tracking()?.id ?? null;
  }

  private tracking(): { url: string; id: string } | null {
    const url = GetServerSettingOrDefault(ServerSetting.TrackingUrl);
    const id = GetServerSettingOrDefault(ServerSetting.TrackingId);
    return url === null || id === null ? null : { url, id };
  }
}
