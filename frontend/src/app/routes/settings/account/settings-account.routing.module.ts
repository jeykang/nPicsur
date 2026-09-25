import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SettingsAccountComponent } from './settings-account.component';
import { PRoutes } from '../../../models/dto/picsur-routes.dto';

const routes: PRoutes = [
  {
    path: '',
    component: SettingsAccountComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SettingsAccountRoutingModule {}
