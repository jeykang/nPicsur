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
    'Keeps the file of every image you upload exactly as it was uploaded, next to the image Picsur makes of it. That includes its metadata, like EXIF data with the place a photo was taken.',
};
