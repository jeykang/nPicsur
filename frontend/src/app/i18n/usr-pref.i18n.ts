import { UsrPreference } from 'picsur-shared/dist/dto/usr-preferences.enum';

export const UsrPreferenceFriendlyNames: {
  [key in UsrPreference]: string;
} = {
  [UsrPreference.KeepOriginal]: 'Keep original file',
  [UsrPreference.DefaultExpiry]: 'New images expire after',
};

export const UsrPreferenceHelpText: {
  [key in UsrPreference]: string;
} = {
  [UsrPreference.KeepOriginal]:
    'Preserve original files, including metadata such as photo locations.',
  [UsrPreference.DefaultExpiry]:
    'Applies to future uploads. You can change each image’s expiry later.',
};
