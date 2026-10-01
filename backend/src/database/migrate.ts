import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GetDbConnectionOptions } from '../config/db-connection.js';
import { EntityList } from './entities/index.js';
import { MigrationList } from './migrations/index.js';

// Brings the database up to date before Picsur reads its settings, as
// migrations can move settings there. The database often starts at the same
// time, so this waits for it like TypeORM would.
export async function MigrateDatabase(
  attempts = 10,
  delayMs = 3000,
): Promise<void> {
  const logger = new Logger('Database');

  for (let attempt = 1; ; attempt++) {
    const dataSource = new DataSource({
      type: 'postgres',
      ...GetDbConnectionOptions((name) => process.env[name]),
      // TypeORM installs the extensions these need, like uuid-ossp
      entities: EntityList,
      migrations: MigrationList,
    });
    try {
      await dataSource.initialize();
    } catch (e: any) {
      if (attempt >= attempts) throw e;
      logger.warn(
        `Can not reach the database yet, trying again: ${e?.message ?? e}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    try {
      const ran = await dataSource.runMigrations({ transaction: 'all' });
      if (ran.length > 0) {
        logger.log(
          `Updated the database: ${ran.map((migration) => migration.name).join(', ')}`,
        );
      }
      return;
    } finally {
      await dataSource.destroy().catch(() => undefined);
    }
  }
}
