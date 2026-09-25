import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ServerRestartResponse,
  ServerSettingsResponse,
  ServerSettingsUpdateRequest,
  StorageStatusResponse,
  StorageTestResponse,
} from 'picsur-shared/dist/dto/api/server.dto';
import { ThrowIfFailed } from 'picsur-shared/dist/types/failable';
import { EasyThrottle } from '../../../decorators/easy-throttle.decorator.js';
import { RequiredPermissions } from '../../../decorators/permissions.decorator.js';
import { Returns } from '../../../decorators/returns.decorator.js';
import { ServerSettingsService } from '../../../managers/server/server-settings.service.js';
import { StorageMigrationService } from '../../../managers/server/storage-migration.service.js';
import { Permission } from '../../../models/constants/permissions.const.js';

// Settings of the server itself, like where images are stored. They take
// effect when Picsur restarts, which can be done from here too.
@Controller('api/server')
@RequiredPermissions(Permission.SysPrefAdmin)
export class ServerController {
  constructor(
    private readonly settingsService: ServerSettingsService,
    private readonly migrationService: StorageMigrationService,
  ) {}

  @Get('settings')
  @Returns(ServerSettingsResponse)
  async getSettings(): Promise<ServerSettingsResponse> {
    return ThrowIfFailed(await this.settingsService.describe());
  }

  @Post('settings')
  @Returns(ServerSettingsResponse)
  @EasyThrottle(20)
  async updateSettings(
    @Body() body: ServerSettingsUpdateRequest,
  ): Promise<ServerSettingsResponse> {
    return ThrowIfFailed(await this.settingsService.update(body.values));
  }

  // Tries out the storage that the given changes would result in
  @Post('settings/test-storage')
  @Returns(StorageTestResponse)
  @EasyThrottle(20)
  async testStorage(
    @Body() body: ServerSettingsUpdateRequest,
  ): Promise<StorageTestResponse> {
    return ThrowIfFailed(await this.settingsService.testStorage(body.values));
  }

  @Post('restart')
  @Returns(ServerRestartResponse)
  @EasyThrottle(5)
  async restart(): Promise<ServerRestartResponse> {
    return { started_at: ThrowIfFailed(await this.settingsService.restart()) };
  }

  @Get('storage')
  @Returns(StorageStatusResponse)
  async getStorage(): Promise<StorageStatusResponse> {
    return ThrowIfFailed(await this.settingsService.storageStatus());
  }

  // Moves image files to where new ones are stored, in the background
  @Post('storage/migrate')
  @Returns(StorageStatusResponse)
  @EasyThrottle(10)
  async startMigration(): Promise<StorageStatusResponse> {
    ThrowIfFailed(await this.migrationService.start());
    return ThrowIfFailed(await this.settingsService.storageStatus());
  }

  @Post('storage/migrate/stop')
  @Returns(StorageStatusResponse)
  async stopMigration(): Promise<StorageStatusResponse> {
    this.migrationService.stop();
    return ThrowIfFailed(await this.settingsService.storageStatus());
  }
}
