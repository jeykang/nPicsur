import { Portal, CdkPortalOutlet } from '@angular/cdk/portal';
import {
  Component,
  OnInit,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  MatSidenav,
  MatSidenavContainer,
  MatSidenavContent,
} from '@angular/material/sidenav';
import {
  ActivatedRoute,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterOutlet,
} from '@angular/router';
import { AutoUnsubscribe } from 'ngx-auto-unsubscribe-decorator';
import { Failure } from 'picsur-shared/dist/types/failable';
import { RouteTransitionAnimations } from './app.animation';
import { PRouteData } from './models/dto/picsur-routes.dto';
import { PermissionService } from './services/api/permission.service';
import { UsageService } from './services/usage/usage.service';
import { BootstrapService } from './util/bootstrap.service';
import { HeaderComponent } from './components/header/header.component';
import { MatButton } from '@angular/material/button';
import { FooterComponent } from './components/footer/footer.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  animations: [RouteTransitionAnimations],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    HeaderComponent,
    MatSidenavContainer,
    MatSidenav,
    CdkPortalOutlet,
    MatSidenavContent,
    MatButton,
    RouterOutlet,
    FooterComponent,
  ],
})
export class AppComponent implements OnInit {
  private readonly logger = console;

  @ViewChild(MatSidenav) sidebar: MatSidenav;

  loading = false;
  private loadingTimeout: number | null = null;

  sidebarPortal: Portal<any> | undefined = undefined;

  isDesktop = false;
  hasSidebar = false;

  // Nothing works without knowing what we are allowed to do, so the page is
  // replaced by an error while that cannot be loaded
  loadFailure: Failure | null = null;
  retrying = false;

  public constructor(
    private readonly router: Router,
    private readonly activatedRoute: ActivatedRoute,
    private readonly bootstrapService: BootstrapService,
    private readonly permissionService: PermissionService,
    // Not used here, injecting it is what starts it
    private readonly usageService: UsageService,
  ) {}

  public async retry() {
    this.retrying = true;
    await this.permissionService.retryNow();
    this.retrying = false;
  }

  public getRouteAnimData() {
    // Everyone is doing shit with the activated route
    // This seems so much cleaner tho
    // Am I just missing something, or is everyone else missing something?
    return this.router.url;
  }

  public ngOnInit() {
    this.subscribeRouter();
    this.subscribeMobile();
    this.subscribeLoadFailure();
  }

  @AutoUnsubscribe()
  private subscribeLoadFailure() {
    return this.permissionService.loadFailure.subscribe((failure) => {
      this.loadFailure = failure;
    });
  }

  @AutoUnsubscribe()
  private subscribeRouter() {
    return this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.loadingStart();
      }
      // Also when it failed or was replaced by another one, which would
      // otherwise leave the loading bar running
      if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.loadingEnd();
      }
      if (event instanceof NavigationEnd) this.onNavigationEnd();
    });
  }

  @AutoUnsubscribe()
  private subscribeMobile() {
    return this.bootstrapService.isNotMobile().subscribe((state) => {
      this.isDesktop = state;
      this.updateSidebar();
    });
  }

  private async onNavigationEnd() {
    const data = this.routeData;

    if (data._sidebar_portal !== undefined) {
      this.sidebarPortal = data._sidebar_portal;
      this.hasSidebar = true;
    } else {
      this.hasSidebar = false;
    }
    this.updateSidebar();
  }

  private loadingStart() {
    if (this.loadingTimeout !== null) clearTimeout(this.loadingTimeout);

    this.loadingTimeout = window.setTimeout(() => {
      this.loading = true;
    }, 500);
  }

  private loadingEnd() {
    if (this.loadingTimeout !== null) clearTimeout(this.loadingTimeout);
    this.loadingTimeout = null;

    this.loading = false;
  }

  private updateSidebar() {
    if (!this.sidebar) return;

    if (
      this.sidebarPortal === undefined ||
      !this.hasSidebar ||
      !this.isDesktop
    ) {
      this.sidebar.opened = false;
    } else {
      this.sidebar.opened = true;
    }
  }

  // Recusively collect and merge all route data
  private get routeData(): PRouteData {
    let currentRoute: ActivatedRoute | null = this.activatedRoute;
    let accumulate: PRouteData = {};
    while (currentRoute !== null) {
      const data = currentRoute.snapshot.data;
      if (data !== undefined) {
        accumulate = {
          ...accumulate,
          ...data,
        };
      }
      currentRoute = currentRoute.firstChild;
    }
    return accumulate;
  }
}
