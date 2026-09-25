import { Column, Entity, PrimaryColumn } from 'typeorm';

export const ServerSettingsTable = 'e_server_setting_backend';

// Server settings changed on the settings page. These are also read directly
// before Picsur starts, see config/server-settings.ts.
@Entity({ name: ServerSettingsTable })
export class EServerSettingBackend {
  @PrimaryColumn({ type: 'varchar' })
  key: string;

  @Column({ type: 'varchar', nullable: false })
  value: string;
}
