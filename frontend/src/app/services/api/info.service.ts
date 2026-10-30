import { DOCUMENT } from '@angular/common';
import { Inject, Injectable } from '@angular/core';
import { WA_LOCATION } from '@ng-web-apis/common';
import { InfoResponse } from 'picsur-shared/dist/dto/api/info.dto';
import { AsyncFailable, HasFailed } from 'picsur-shared/dist/types/failable';
import { BehaviorSubject, filter, Observable, take } from 'rxjs';
import { ServerInfo } from '../../models/dto/server-info.dto';
import { Logger } from '../logger/logger.service';
import { InfoStorageService } from '../storage/info-storage.service';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root',
})
export class InfoService {
  private readonly logger = new Logger(InfoService.name);

  public get live() {
    return this.infoSubject;
  }

  public get snapshot() {
    return this.infoSubject.value;
  }

  private infoSubject: BehaviorSubject<ServerInfo>;
  constructor(
    @Inject(WA_LOCATION) private readonly location: Location,
    @Inject(DOCUMENT) private readonly document: Document,
    private readonly api: ApiService,
    private readonly infoStorage: InfoStorageService,
  ) {
    this.updateInfo().catch((e) => this.logger.warn(e));
    this.infoSubject = new BehaviorSubject<ServerInfo>(
      this.infoStorage?.get() ?? new ServerInfo(),
    );
  }

  public async getLoadedSnapshot(): Promise<ServerInfo> {
    if (this.isLoaded()) {
      return this.snapshot;
    }

    return new Promise((resolve) => {
      const filtered = this.live.pipe(
        filter((info) => info.version !== '0.0.0'),
        take(1),
      );
      (filtered as Observable<ServerInfo>).subscribe(resolve);
    });
  }

  // Where Picsur is, like https://example.com or https://example.com/picsur
  public getHostname(allowOverride = false): string {
    if (allowOverride) {
      const info = this.snapshot;

      if (info.host_override !== undefined) {
        return info.host_override.replace(/\/+$/, '');
      }
    }

    return this.location.protocol + '//' + this.location.host + this.basePath;
  }

  // The path Picsur is served under, like /picsur, or '' at the root. The
  // server sets the base of the page to it.
  public get basePath(): string {
    const base = new URL(this.document.baseURI).pathname;
    return base.replace(/\/+$/, '');
  }

  public isLoaded(): boolean {
    return this.snapshot.version !== '0.0.0';
  }

  public async updateInfo(): AsyncFailable<ServerInfo> {
    const response = await this.api.get(InfoResponse, '/api/info').result;
    if (HasFailed(response)) return response;

    this.infoSubject.next(response);
    this.infoStorage.set(response);
    return response;
  }
}
