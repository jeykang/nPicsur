import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import { ImagesComponent } from './images.component';
import { PermissionGuard } from '../../guards/permission.guard';
import { PRoutes } from '../../models/dto/picsur-routes.dto';

const routes: PRoutes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: '1',
  },
  {
    path: ':page',
    component: ImagesComponent,
    canActivate: [PermissionGuard],
    data: {
      permissions: [Permission.ImageUpload],
    },
  },
];

export default routes;
