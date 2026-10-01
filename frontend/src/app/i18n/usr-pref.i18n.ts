import { UsrPreference } from 'picsur-shared/dist/dto/usr-preferences.enum';

export const UsrPreferenceFriendlyNames: {
  [key in UsrPreference]: string;
} = {
  [UsrPreference.KeepOriginal]: 'Keep original file',
};

export const UsrPreferenceHelpText: {
  [key in UsrPreference]: string;
} = {
  [UsrPreference.KeepOriginal]:
    'Keeps your uploads exactly as uploaded, including metadata like where a photo was taken.',
};
