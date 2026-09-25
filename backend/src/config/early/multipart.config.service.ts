import { Injectable, Logger } from '@nestjs/common';
import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { ParseInt } from 'picsur-shared/dist/util/parse-simple';
import { DefaultMaxFileSize, GetServerSetting } from '../server-settings.js';

@Injectable()
export class MultipartConfigService {
  private readonly logger = new Logger(MultipartConfigService.name);

  constructor() {
    this.logger.log('Max file size: ' + this.getMaxFileSize());
  }

  public getMaxFileSize(): number {
    return ParseInt(
      GetServerSetting(ServerSetting.MaxFileSize),
      DefaultMaxFileSize,
    );
  }

  public getLimits(fileLimit?: number) {
    return {
      fieldNameSize: 128,
      fieldSize: 1024,
      fields: 20,
      files: fileLimit ?? 20,
      fileSize: this.getMaxFileSize(),
    };
  }
}
