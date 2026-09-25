import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FileType2Ext, ImageFileType } from 'picsur-shared/dist/dto/mimes.dto';
import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { ApiKeysService } from '../../../services/api/apikeys.service';
import { InfoService } from '../../../services/api/info.service';
import { PermissionService } from '../../../services/api/permission.service';
import { Logger } from '../../../services/logger/logger.service';
import { ErrorService } from '../../../util/error-manager/error.service';
import { UtilService } from '../../../util/util.service';
import { BuildShareX } from './sharex-builder';

@Component({
  templateUrl: './settings-sharex.component.html',
  styleUrls: ['./settings-sharex.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsShareXComponent implements OnInit {
  private readonly logger = new Logger(SettingsShareXComponent.name);

  public selectedFormat: string = ImageFileType.PNG;
  public formatOptions: {
    value: string;
    key: string;
  }[] = [];

  public exporting = false;

  constructor(
    private readonly apikeysService: ApiKeysService,
    private readonly permissionService: PermissionService,
    private readonly infoService: InfoService,
    private readonly utilService: UtilService,
    private readonly errorService: ErrorService,
  ) {}

  ngOnInit(): void {
    this.formatOptions = this.utilService.getBaseFormatOptions();
  }

  async onExport() {
    this.exporting = true;
    try {
      await this.export();
    } finally {
      this.exporting = false;
    }
  }

  // Api keys can only be read when they are created, so every config gets a
  // new one
  private async export() {
    const permissions = await this.permissionService.getLoadedSnapshot();
    const canUseDelete = permissions.includes(Permission.ImageDeleteKey);

    const ext = FileType2Ext(this.selectedFormat);
    if (HasFailed(ext)) {
      ext.print(this.logger);
    }

    const apikey = await this.apikeysService.createApiKey();
    if (HasFailed(apikey)) {
      return this.errorService.showFailure(apikey, this.logger);
    }
    const renamed = await this.apikeysService.updateApiKey(apikey.id, 'ShareX');
    if (HasFailed(renamed)) {
      renamed.print(this.logger);
    }

    const sharexConfig = BuildShareX(
      this.infoService.getHostname(),
      apikey.key,
      '.' + ext,
      canUseDelete,
    );

    this.utilService.downloadBuffer(
      JSON.stringify(sharexConfig),
      'Pisur-ShareX-target.sxcu',
      'application/json',
    );

    this.errorService.success('Exported ShareX config');
  }
}
