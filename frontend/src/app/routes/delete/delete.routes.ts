import { DeleteComponent } from './delete.component';
import { PRoutes } from '../../models/dto/picsur-routes.dto';

const routes: PRoutes = [
  {
    path: ':id/:key',
    component: DeleteComponent,
  },
];

export default routes;
