import { MigrationInterface, QueryRunner } from 'typeorm';

// Images can be shown in a public gallery, which guests and users may see
export class V060D1790335094391 implements MigrationInterface {
  name = 'V060D1790335094391';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_image_backend" ADD "listed" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2039e8f3e78b26ef97f5c34893" ON "e_image_backend" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8ae1655499c9e2ecb946a6f4f9" ON "e_image_backend" ("listed") `,
    );
    // New instances give this permission to the guest and user roles, so
    // existing ones get it as well
    await queryRunner.query(
      `UPDATE "e_role_backend" SET "permissions" = array_append("permissions", 'gallery-view') WHERE "name" IN ('guest', 'user') AND NOT ('gallery-view' = ANY("permissions"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "e_role_backend" SET "permissions" = array_remove("permissions", 'gallery-view')`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8ae1655499c9e2ecb946a6f4f9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2039e8f3e78b26ef97f5c34893"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_backend" DROP COLUMN "listed"`,
    );
  }
}
