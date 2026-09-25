import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import { AlbumComponent } from './album.component';
import { PermissionGuard } from '../../guards/permission.guard';
import { PRoutes } from '../../models/dto/picsur-routes.dto';

const routes: PRoutes = [
  {
    path: ':id',
    component: AlbumComponent,
    canActivate: [PermissionGuard],
    data: {
      permissions: [Permission.ImageView],
    },
  },
  {
    path: ':id/:page',
    component: AlbumComponent,
    canActivate: [PermissionGuard],
    data: {
      permissions: [Permission.ImageView],
    },
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AlbumRoutingModule {}
