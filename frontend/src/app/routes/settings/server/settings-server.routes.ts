import { SettingsServerComponent } from './settings-server.component';
import { PRoutes } from '../../../models/dto/picsur-routes.dto';

const routes: PRoutes = [
  {
    path: '',
    component: SettingsServerComponent,
  },
];

export default routes;
