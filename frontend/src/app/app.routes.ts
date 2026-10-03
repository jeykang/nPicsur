import { PRoutes } from './models/dto/picsur-routes.dto';

export const AppRoutes: PRoutes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'upload',
  },
  {
    path: 'upload',
    loadChildren: () => import('./routes/upload/upload.routes'),
  },
  {
    path: 'processing',
    loadChildren: () => import('./routes/processing/processing.routes'),
  },
  {
    path: 'view',
    loadChildren: () => import('./routes/view/view.routes'),
  },
  {
    path: 'user',
    loadChildren: () => import('./routes/user/user.routes'),
  },
  {
    path: 'images',
    loadChildren: () => import('./routes/images/images.routes'),
  },
  {
    path: 'albums',
    loadChildren: () => import('./routes/albums/albums.routes'),
  },
  {
    path: 'album',
    loadChildren: () => import('./routes/album/album.routes'),
  },
  {
    path: 'gallery',
    loadChildren: () => import('./routes/gallery/gallery.routes'),
  },
  {
    path: 'settings',
    loadChildren: () => import('./routes/settings/settings.routes'),
  },
  {
    path: 'delete',
    loadChildren: () => import('./routes/delete/delete.routes'),
  },
  {
    path: 'error',
    loadChildren: () => import('./routes/errors/errors.routes'),
  },
  // Any other address, like a mistyped one
  {
    path: '**',
    redirectTo: '/error/404',
  },
];
