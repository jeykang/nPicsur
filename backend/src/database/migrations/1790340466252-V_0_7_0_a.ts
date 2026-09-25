import { MigrationInterface, QueryRunner } from 'typeorm';

// Server settings changed on the settings page
export class V070A1790340466252 implements MigrationInterface {
  name = 'V070A1790340466252';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "e_server_setting_backend" ("key" character varying NOT NULL, "value" character varying NOT NULL, CONSTRAINT "PK_6d00e0115a01d1ea8fee25033df" PRIMARY KEY ("key"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "e_server_setting_backend"`);
  }
}
