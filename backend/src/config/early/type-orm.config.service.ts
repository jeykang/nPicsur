import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { EntityList } from '../../database/entities/index.js';
import { MigrationList } from '../../database/migrations/index.js';
import { GetDbConnectionOptions } from '../db-connection.js';
import { HostConfigService } from './host.config.service.js';

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
  private readonly logger = new Logger(TypeOrmConfigService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly hostService: HostConfigService,
  ) {
    const varOptions = this.getTypeOrmServerOptions();

    this.logger.log('DB host: ' + varOptions.host);
    this.logger.log('DB port: ' + varOptions.port);
    this.logger.log('DB database: ' + varOptions.database);

    this.logger.verbose('DB username: ' + varOptions.username);
  }

  public getTypeOrmServerOptions() {
    return GetDbConnectionOptions((name) => this.configService.get(name));
  }

  public createTypeOrmOptions() {
    const varOptions = this.getTypeOrmServerOptions();
    return {
      type: 'postgres' as const,
      synchronize: !this.hostService.isProduction(),

      migrationsRun: true,

      entities: EntityList,
      migrations: MigrationList,

      useUTC: true,

      cli: {
        migrationsDir: 'src/database/migrations',
        entitiesDir: 'src/database/entities',
      },

      ...varOptions,
    } as TypeOrmModuleOptions;
  }
}
