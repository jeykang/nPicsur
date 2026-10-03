import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import { AlbumsComponent } from './albums.component';
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
    component: AlbumsComponent,
    canActivate: [PermissionGuard],
    data: {
      permissions: [Permission.ImageManage],
    },
  },
];

export default routes;
