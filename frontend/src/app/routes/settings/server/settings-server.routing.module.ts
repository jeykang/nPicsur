import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SettingsServerComponent } from './settings-server.component';
import { PRoutes } from '../../../models/dto/picsur-routes.dto';

const routes: PRoutes = [
  {
    path: '',
    component: SettingsServerComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SettingsServerRoutingModule {}
