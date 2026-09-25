import { Injectable } from '@angular/core';
import {
  ServerRestartResponse,
  ServerSettingsResponse,
  ServerSettingsUpdateRequest,
  StorageStatusResponse,
  StorageTestResponse,
} from 'picsur-shared/dist/dto/api/server.dto';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { ApiService } from './api.service';

// How long a restart may take before giving up on it
const RESTART_TIMEOUT_MS = 2 * 60 * 1000;

@Injectable({
  providedIn: 'root',
})
export class ServerSettingsService {
  constructor(private readonly api: ApiService) {}

  public getSettings(): AsyncFailable<ServerSettingsResponse> {
    return this.api.get(ServerSettingsResponse, '/api/server/settings').result;
  }

  // A value of null goes back to the default
  public updateSettings(
    values: Record<string, string | null>,
  ): AsyncFailable<ServerSettingsResponse> {
    return this.api.post(
      ServerSettingsUpdateRequest,
      ServerSettingsResponse,
      '/api/server/settings',
      { values },
    ).result;
  }

  // Tries out the storage the given changes would result in
  public testStorage(
    values: Record<string, string | null>,
  ): AsyncFailable<StorageTestResponse> {
    return this.api.post(
      ServerSettingsUpdateRequest,
      StorageTestResponse,
      '/api/server/settings/test-storage',
      { values },
    ).result;
  }

  // Restarts the server, and waits until it is back
  public async restart(): AsyncFailable<ServerSettingsResponse> {
    const restart = await this.api.postEmpty(
      ServerRestartResponse,
      '/api/server/restart',
    ).result;
    if (HasFailed(restart)) return restart;

    const before = restart.started_at.getTime();
    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const settings = await this.getSettings();
      if (!HasFailed(settings) && settings.started_at.getTime() !== before) {
        return settings;
      }
    }
    return Fail(
      FT.Network,
      'Picsur did not come back after restarting, the server log might say why',
    );
  }

  public getStorage(): AsyncFailable<StorageStatusResponse> {
    return this.api.get(StorageStatusResponse, '/api/server/storage').result;
  }

  public startMigration(): AsyncFailable<StorageStatusResponse> {
    return this.api.postEmpty(
      StorageStatusResponse,
      '/api/server/storage/migrate',
    ).result;
  }

  public stopMigration(): AsyncFailable<StorageStatusResponse> {
    return this.api.postEmpty(
      StorageStatusResponse,
      '/api/server/storage/migrate/stop',
    ).result;
  }
}
