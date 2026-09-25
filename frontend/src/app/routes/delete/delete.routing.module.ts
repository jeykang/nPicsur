import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { DeleteComponent } from './delete.component';
import { PRoutes } from '../../models/dto/picsur-routes.dto';

const routes: PRoutes = [
  {
    path: ':id/:key',
    component: DeleteComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class DeleteRoutingModule {}
