import { Injectable } from '@nestjs/common';
import { PrefValueType } from 'picsur-shared/dist/dto/preferences.dto';
import { UsrPreference } from 'picsur-shared/dist/dto/usr-preferences.enum';

// The default values of user preferences
@Injectable()
export class PreferenceDefaultsService {
  private readonly usrDefaults: {
    [key in UsrPreference]: (() => PrefValueType) | PrefValueType;
  } = {
    [UsrPreference.KeepOriginal]: false,
  };

  public getUsrDefault(pref: UsrPreference): PrefValueType {
    const value = this.usrDefaults[pref];
    if (typeof value === 'function') {
      return value();
    } else {
      return value;
    }
  }
}
