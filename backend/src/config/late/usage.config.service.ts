import { Injectable } from '@nestjs/common';
import { SysPreference } from 'picsur-shared/dist/dto/sys-preferences.enum';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { UUIDRegex } from 'picsur-shared/dist/util/common-regex';
import { IsHttpUrl } from 'picsur-shared/dist/validators/url.validator';
import { SysPreferenceDbService } from '../../collections/preference-db/sys-preference-db.service.js';

@Injectable()
export class UsageConfigService {
  constructor(private readonly sysPref: SysPreferenceDbService) {}

  async getTrackingUrl(): AsyncFailable<string | null> {
    const trackingUrl = await this.sysPref.getStringPreference(
      SysPreference.TrackingUrl,
    );
    if (HasFailed(trackingUrl)) return trackingUrl;

    if (trackingUrl === '') return null;

    if (!IsHttpUrl().safeParse(trackingUrl).success) {
      return Fail(FT.UsrValidation, undefined, 'Invalid tracking URL');
    }

    return trackingUrl;
  }

  async getTrackingID(): AsyncFailable<string | null> {
    const trackingID = await this.sysPref.getStringPreference(
      SysPreference.TrackingId,
    );
    if (HasFailed(trackingID)) return trackingID;

    if (trackingID === '') return null;

    if (!UUIDRegex.test(trackingID)) {
      return Fail(FT.UsrValidation, undefined, 'Invalid tracking ID');
    }

    return trackingID;
  }
}
