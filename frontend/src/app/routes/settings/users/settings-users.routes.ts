import { SettingsUsersEditComponent } from './settings-users-edit/settings-users-edit.component';
import { SettingsUsersComponent } from './settings-users.component';
import { PRoutes } from '../../../models/dto/picsur-routes.dto';

const routes: PRoutes = [
  {
    path: '',
    component: SettingsUsersComponent,
  },
  {
    path: 'edit/:uuid',
    component: SettingsUsersEditComponent,
  },
  {
    path: 'add',
    component: SettingsUsersEditComponent,
  },
];

export default routes;
