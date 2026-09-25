import { Injectable } from '@angular/core';
import { AutoUnsubscribe } from 'ngx-auto-unsubscribe-decorator';
import { UserMePermissionsResponse } from 'picsur-shared/dist/dto/api/user.dto';
import {
  AsyncFailable,
  Failure,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { BehaviorSubject, Observable, filter, map, take } from 'rxjs';
import { Throttle } from '../../util/throttle';
import { Logger } from '../logger/logger.service';
import { ApiService } from './api.service';
import { StaticInfoService } from './static-info.service';
import { UserService } from './user.service';

const RetryDelayMin = 1000;
const RetryDelayMax = 30000;

@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  private allPermissions: string[] = [];
  private permissionsSubject = new BehaviorSubject<string[] | null>(null);

  // Set while the permissions can not be loaded, which usually means the
  // server can not be reached. Nothing works without them, so this is
  // retried with growing pauses until it works.
  private loadFailureSubject = new BehaviorSubject<Failure | null>(null);
  private retryTimeout: number | null = null;
  private retryDelay = RetryDelayMin;

  public get loadFailure(): Observable<Failure | null> {
    return this.loadFailureSubject.asObservable();
  }

  public get live(): Observable<string[]> {
    return this.permissionsSubject.pipe(
      map((permissions) => permissions ?? this.allPermissions),
    );
  }

  public get snapshot(): string[] {
    return this.permissionsSubject.getValue() ?? this.allPermissions;
  }

  // This will not be optimistic, it will instead wait for correct data
  public getLoadedSnapshot(): Promise<string[]> {
    return new Promise((resolve) => {
      const filtered = this.permissionsSubject.pipe(
        filter((permissions) => permissions !== null),
        take(1),
      );
      (filtered as Observable<string[]>).subscribe(resolve);
    });
  }

  constructor(
    private readonly userService: UserService,
    private readonly api: ApiService,
    private readonly staticInfo: StaticInfoService,
  ) {
    this.subscribeUser();
    this.loadAllPermissions().catch(this.logger.error);
  }

  private async loadAllPermissions() {
    this.allPermissions = await this.staticInfo.getAllPermissions();

    if (this.snapshot === null) {
      this.permissionsSubject.next(null);
    }
  }

  @AutoUnsubscribe()
  private subscribeUser() {
    return this.userService.live.pipe(Throttle(300)).subscribe(async () => {
      const permissions = await this.updatePermissions();
      if (HasFailed(permissions)) {
        this.logger.error(permissions.getReason());
        return;
      }
    });
  }

  public async retryNow(): AsyncFailable<true> {
    this.retryDelay = RetryDelayMin;
    return this.updatePermissions();
  }

  private async updatePermissions(): AsyncFailable<true> {
    if (this.retryTimeout !== null) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    const got = await this.api.get(
      UserMePermissionsResponse,
      '/api/user/me/permissions',
    ).result;
    if (HasFailed(got)) {
      this.loadFailureSubject.next(got);
      this.retryTimeout = window.setTimeout(() => {
        this.retryTimeout = null;
        this.updatePermissions().catch(this.logger.error);
      }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, RetryDelayMax);
      return got;
    }

    this.retryDelay = RetryDelayMin;
    this.loadFailureSubject.next(null);
    this.permissionsSubject.next(got.permissions);
    return true;
  }
}
