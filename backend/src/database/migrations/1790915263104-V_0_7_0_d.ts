import { Logger } from '@nestjs/common';
import {
  ParseDuration,
  ServerSetting,
  ServerSettingValidators,
} from 'picsur-shared/dist/dto/server-settings.dto';
import { MigrationInterface, QueryRunner } from 'typeorm';

// The system settings become server settings, which can be set with
// environment variables as well. The secret logins are signed with is kept
// with the other generated secrets.
const SysPreferenceTable = 'e_sys_preference_backend';
const ServerSettingsTable = 'e_server_setting_backend';
const SystemStateTable = 'e_system_state_backend';
const JwtSecret = 'jwt_secret';

// The setting each preference becomes, and its default. Defaults were saved as
// well, those are left out so they keep following the default.
const MovedPreferences: Record<string, { setting: string; default: string }> = {
  host_override: { setting: 'host_override', default: '' },
  jwt_expires_in: { setting: 'jwt_expiry', default: '7d' },
  bcrypt_strength: { setting: 'bcrypt_strength', default: '10' },
  remove_derivatives_after: {
    setting: 'remove_derivatives_after',
    default: '7d',
  },
  allow_editing: { setting: 'allow_editing', default: 'true' },
  conversion_time_limit: { setting: 'conversion_time_limit', default: '15s' },
  conversion_memory_limit: {
    setting: 'conversion_memory_limit',
    default: '512',
  },
  tracking_url: { setting: 'tracking_url', default: '' },
  tracking_id: { setting: 'tracking_id', default: '' },
};

function setByEnvironment(name: string): boolean {
  return !!process.env['PICSUR_' + name.toUpperCase()]?.trim();
}

// What the preference is as a setting, null when it is left out
function asSetting(setting: string, value: string): string | null {
  // Both used to be turned off with 0, which the time limit now does not
  // allow, it meant the default
  if (setting === 'remove_derivatives_after' && ParseDuration(value) === 0) {
    return '0';
  }
  if (setting === 'conversion_time_limit' && ParseDuration(value) === 0) {
    return null;
  }
  return value;
}

export class V070D1790915263104 implements MigrationInterface {
  name = 'V070D1790915263104';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const logger = new Logger('Database');
    if (!(await queryRunner.hasTable(SysPreferenceTable))) return;

    const rows: { key: string; value: string }[] = await queryRunner.query(
      `SELECT "key", "value" FROM "${SysPreferenceTable}"`,
    );
    const moved: string[] = [];
    for (const { key, value } of rows) {
      // Copied from PICSUR_JWT_SECRET when that is set, which still applies
      if (key === JwtSecret) {
        if (setByEnvironment(JwtSecret)) continue;
        await queryRunner.query(
          `INSERT INTO "${SystemStateTable}" ("key", "value") VALUES ($1, $2) ON CONFLICT ("key") DO NOTHING`,
          [JwtSecret, value],
        );
        continue;
      }

      const preference = MovedPreferences[key];
      if (preference === undefined) continue;
      const { setting } = preference;
      // What the environment sets keeps applying, PICSUR_JWT_EXPIRY was copied
      // like the secret
      if (setByEnvironment(setting) || value === preference.default) continue;

      const settingValue = asSetting(setting, value);
      if (settingValue === null) continue;
      const valid =
        ServerSettingValidators[setting as ServerSetting]?.safeParse(
          settingValue,
        );
      if (!valid?.success) {
        logger.warn(
          `Leaving out ${key}, "${value}" is not a valid ${setting}: ${valid?.error.issues[0]?.message ?? 'unknown setting'}`,
        );
        continue;
      }

      await queryRunner.query(
        `INSERT INTO "${ServerSettingsTable}" ("key", "value") VALUES ($1, $2) ON CONFLICT ("key") DO NOTHING`,
        [setting, settingValue],
      );
      moved.push(setting);
    }

    await queryRunner.query(`DROP TABLE "${SysPreferenceTable}"`);
    if (moved.length > 0) {
      logger.log(
        `The system settings are server settings now: ${moved.join(', ')}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "${SysPreferenceTable}" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" character varying NOT NULL, "value" character varying NOT NULL, CONSTRAINT "UQ_b04e47c4814fb6e315c5879fa75" UNIQUE ("key"), CONSTRAINT "PK_b79f051e19b46e74cf255e9ba3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b04e47c4814fb6e315c5879fa7" ON "${SysPreferenceTable}" ("key") `,
    );

    // Back to where the previous version reads them
    const moveBack = async (table: string, from: string, to: string) => {
      const rows: { value: string }[] = await queryRunner.query(
        `SELECT "value" FROM "${table}" WHERE "key" = $1`,
        [from],
      );
      if (rows.length === 0) return;
      await queryRunner.query(
        `INSERT INTO "${SysPreferenceTable}" ("key", "value") VALUES ($1, $2)`,
        [to, rows[0].value],
      );
      await queryRunner.query(`DELETE FROM "${table}" WHERE "key" = $1`, [
        from,
      ]);
    };
    for (const [key, { setting }] of Object.entries(MovedPreferences)) {
      await moveBack(ServerSettingsTable, setting, key);
    }
    await moveBack(SystemStateTable, JwtSecret, JwtSecret);
  }
}
