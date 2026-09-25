import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import { GalleryComponent } from './gallery.component';
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
    component: GalleryComponent,
    canActivate: [PermissionGuard],
    data: {
      permissions: [Permission.GalleryView],
    },
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class GalleryRoutingModule {}
