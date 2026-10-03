import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import { SettingsSidebarComponent } from './sidebar/settings-sidebar.component';
import { PermissionGuard } from '../../guards/permission.guard';
import { PRoutes } from '../../models/dto/picsur-routes.dto';
import { SidebarResolverService } from '../../services/sidebar-resolver/sidebar-resolver.service';

const SettingsRoutes: PRoutes = [
  {
    path: '',
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'general',
      },
      {
        path: 'general',
        loadChildren: () => import('./general/settings-general.routes'),
        data: {
          permissions: [Permission.Settings],
          page: {
            title: 'Preferences',
            icon: 'settings',
            category: 'personal',
          },
        },
      },
      {
        path: 'account',
        loadChildren: () => import('./account/settings-account.routes'),
        data: {
          permissions: [Permission.UserKeepLogin],
          page: {
            title: 'Account',
            icon: 'account_circle',
            category: 'personal',
          },
        },
      },
      {
        path: 'apikeys',
        loadChildren: () => import('./apikeys/settings-apikeys.routes'),
        data: {
          permissions: [Permission.ApiKey],
          page: {
            title: 'API keys',
            icon: 'key',
            category: 'personal',
          },
        },
      },
      {
        path: 'sharex',
        loadChildren: () => import('./sharex/settings-sharex.routes'),
        data: {
          permissions: [Permission.ApiKey],
          page: {
            title: 'ShareX',
            icon: 'install_desktop',
            category: 'personal',
          },
        },
      },
      {
        path: 'users',
        loadChildren: () => import('./users/settings-users.routes'),
        data: {
          permissions: [Permission.UserAdmin],
          page: {
            title: 'Users',
            icon: 'people_outline',
            category: 'system',
          },
        },
      },
      {
        path: 'roles',
        loadChildren: () => import('./roles/settings-roles.routes'),
        data: {
          permissions: [Permission.RoleAdmin],
          page: {
            title: 'Roles',
            icon: 'admin_panel_settings',
            category: 'system',
          },
        },
      },
      // The system settings are part of the server settings now
      {
        path: 'system',
        pathMatch: 'full',
        redirectTo: 'server',
      },
      {
        path: 'server',
        loadChildren: () => import('./server/settings-server.routes'),
        data: {
          permissions: [Permission.SysPrefAdmin],
          page: {
            title: 'Server',
            icon: 'dns',
            category: 'system',
          },
        },
      },
    ],
    canActivate: [PermissionGuard],
    canActivateChild: [PermissionGuard],
    data: {
      sidebar: SettingsSidebarComponent,
    },
    resolve: SidebarResolverService.build(),
    // The sidebar lists these pages. It gets them from the injector of this
    // route, which the resolver hands to it.
    providers: [
      {
        provide: 'SettingsRoutes',
        useFactory: () => SettingsRoutes[0].children,
      },
    ],
  },
];

export default SettingsRoutes;
