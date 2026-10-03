import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import { PermissionGuard } from '../../guards/permission.guard';
import { PRoutes } from '../../models/dto/picsur-routes.dto';
import { ViewComponent } from './view.component';

const routes: PRoutes = [
  {
    path: ':id',
    component: ViewComponent,
    canActivate: [PermissionGuard],
    data: { permissions: [Permission.ImageView] },
  },
];

export default routes;
