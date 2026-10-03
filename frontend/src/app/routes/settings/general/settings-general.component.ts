import { Component, ChangeDetectionStrategy } from '@angular/core';
import {
  DecodedPref,
  PrefValueType,
} from 'picsur-shared/dist/dto/preferences.dto';
import { UsrPreference } from 'picsur-shared/dist/dto/usr-preferences.enum';
import { Observable } from 'rxjs';
import {
  UsrPreferenceFriendlyNames,
  UsrPreferenceHelpText,
} from '../../../i18n/usr-pref.i18n';
import { UsrPrefService } from '../../../services/api/usr-pref.service';
import { ExpiryName, ExpiryOptions } from '../../../util/expiry-options';
import { PrefOptionComponent } from '../../../components/pref-option/pref-option.component';
import { AsyncPipe } from '@angular/common';

interface Option {
  name: string;
  value: PrefValueType;
}

const ExpiryValues: Option[] = ExpiryOptions.map(({ name, seconds }) => ({
  name,
  value: seconds,
}));

@Component({
  templateUrl: './settings-general.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [PrefOptionComponent, AsyncPipe],
})
export class SettingsGeneralComponent {
  private readonly translator = UsrPreferenceFriendlyNames;
  private readonly helpTranslator = UsrPreferenceHelpText;

  public getName(key: string) {
    return (this.translator as any)[key] ?? key;
  }

  public getHelpText(key: string) {
    return (this.helpTranslator as any)[key] ?? '';
  }

  // A time set through the api can be none of the options, it is added then
  private readonly otherExpiry = new Map<number, Option[]>();

  public getOptions(pref: DecodedPref): Option[] | undefined {
    if (pref.key !== UsrPreference.DefaultExpiry) return undefined;
    const seconds = pref.value;
    if (
      typeof seconds !== 'number' ||
      ExpiryValues.some(({ value }) => value === seconds)
    ) {
      return ExpiryValues;
    }
    let options = this.otherExpiry.get(seconds);
    if (options === undefined) {
      options = [
        ...ExpiryValues,
        { name: ExpiryName(seconds), value: seconds },
      ];
      this.otherExpiry.set(seconds, options);
    }
    return options;
  }

  preferences: Observable<DecodedPref[]>;

  constructor(public readonly usrPrefService: UsrPrefService) {
    this.preferences = usrPrefService.live;
  }
}
