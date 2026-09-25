import { Portal } from '@angular/cdk/portal';
import {
  Component,
  OnInit,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatSidenav } from '@angular/material/sidenav';
import {
  ActivatedRoute,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';
import { AutoUnsubscribe } from 'ngx-auto-unsubscribe-decorator';
import { Failure } from 'picsur-shared/dist/types/failable';
import { RouteTransitionAnimations } from './app.animation';
import { PRouteData } from './models/dto/picsur-routes.dto';
import { PermissionService } from './services/api/permission.service';
import { UsageService } from './services/usage/usage.service';
import { BootstrapService } from './util/bootstrap.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  animations: [RouteTransitionAnimations],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class AppComponent implements OnInit {
  private readonly logger = console;

  @ViewChild(MatSidenav) sidebar: MatSidenav;

  loading = false;
  private loadingTimeout: number | null = null;

  wrapContentWithContainer = true;
  sidebarPortal: Portal<any> | undefined = undefined;

  isDesktop = false;
  hasSidebar = false;

  // Nothing works without knowing what we are allowed to do, so the page is
  // replaced by an error while that can not be loaded
  loadFailure: Failure | null = null;
  retrying = false;

  public constructor(
    private readonly router: Router,
    private readonly activatedRoute: ActivatedRoute,
    private readonly bootstrapService: BootstrapService,
    private readonly permissionService: PermissionService,
    usageService: UsageService,
  ) {
    usageService;
  }

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
      if (event instanceof NavigationEnd) {
        this.loadingEnd();
      }
      if (event instanceof NavigationEnd) this.onNavigationEnd();
      if (event instanceof NavigationError) this.onNavigationError(event);
    });
  }

  @AutoUnsubscribe()
  private subscribeMobile() {
    return this.bootstrapService.isNotMobile().subscribe((state) => {
      this.isDesktop = state;
      this.updateSidebar();
    });
  }

  private async onNavigationError(event: NavigationError) {
    // 404 handler
    const error: Error = event.error;
    if (error.message.startsWith('Cannot match any routes'))
      this.router.navigate(['/error/404'], { replaceUrl: true });
  }

  private async onNavigationEnd() {
    const data = this.routeData;
    this.wrapContentWithContainer = !data.noContainer;

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
