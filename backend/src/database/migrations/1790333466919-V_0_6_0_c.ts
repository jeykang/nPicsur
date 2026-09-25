import { createHash } from 'node:crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';

// Api keys are stored as a hash, with their last characters to tell them
// apart. Existing keys keep working.
export class V060C1790333466919 implements MigrationInterface {
  name = 'V060C1790333466919';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_api_key_backend" ADD "key_hash" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_api_key_backend" ADD "key_hint" character varying`,
    );

    const apikeys: { id: string; key: string }[] = await queryRunner.query(
      `SELECT "id", "key" FROM "e_api_key_backend"`,
    );
    for (const { id, key } of apikeys) {
      await queryRunner.query(
        `UPDATE "e_api_key_backend" SET "key_hash" = $1, "key_hint" = $2 WHERE "id" = $3`,
        [createHash('sha256').update(key).digest('hex'), key.slice(-4), id],
      );
    }

    await queryRunner.query(
      `ALTER TABLE "e_api_key_backend" ALTER COLUMN "key_hash" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_api_key_backend" ALTER COLUMN "key_hint" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_api_key_backend" ADD CONSTRAINT "UQ_d5c7dc06c52a77b6bd51125ed67" UNIQUE ("key_hash")`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a244964afdff398bab8a45017c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_api_key_backend" DROP CONSTRAINT "UQ_a244964afdff398bab8a45017c8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_api_key_backend" DROP COLUMN "key"`,
    );
  }

  // The keys themselves are gone, so going back deletes every api key
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "e_api_key_backend"`);
    await queryRunner.query(
      `ALTER TABLE "e_api_key_backend" DROP COLUMN "key_hint"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_api_key_backend" DROP CONSTRAINT "UQ_d5c7dc06c52a77b6bd51125ed67"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_api_key_backend" DROP COLUMN "key_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_api_key_backend" ADD "key" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_api_key_backend" ADD CONSTRAINT "UQ_a244964afdff398bab8a45017c8" UNIQUE ("key")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a244964afdff398bab8a45017c" ON "e_api_key_backend" ("key") `,
    );
  }
}
