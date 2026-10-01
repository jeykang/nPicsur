import { Permission } from 'picsur-shared/dist/dto/permissions.enum';

export const UIFriendlyPermissions: {
  [key in Permission]: string;
} = {
  [Permission.ImageView]: 'View images',
  [Permission.ImageUpload]: 'Upload images',
  [Permission.ImageManage]: 'Manage own images',
  [Permission.ImageDeleteKey]: 'Use deletion links',
  [Permission.GalleryView]: 'View the gallery',

  [Permission.UserLogin]: 'Log in',
  [Permission.UserKeepLogin]: 'Stay logged in',
  [Permission.UserRegister]: 'Register',

  [Permission.Settings]: 'Change preferences',

  [Permission.ApiKey]: 'Use API keys',

  [Permission.ImageAdmin]: 'Manage all images and albums',
  [Permission.UserAdmin]: 'Manage users',
  [Permission.RoleAdmin]: 'Manage roles',
  [Permission.ApiKeyAdmin]: 'Manage all API keys',
  [Permission.SysPrefAdmin]: 'Change server settings',
};
