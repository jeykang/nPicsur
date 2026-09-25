import { MigrationInterface, QueryRunner } from 'typeorm';

export class V070B1790358552443 implements MigrationInterface {
  name = 'V070B1790358552443';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_image_derivative_backend" DROP CONSTRAINT "CHK_f146949e158946cbd247c482b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_file_backend" DROP CONSTRAINT "CHK_0744bfe845dcafb19afa814835"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_derivative_backend" ADD "storage" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_file_backend" ADD "storage" character varying`,
    );
    // Everything stored outside the database so far is in a bucket
    await queryRunner.query(
      `UPDATE "e_image_derivative_backend" SET "storage" = 's3' WHERE "storage_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "e_image_file_backend" SET "storage" = 's3' WHERE "storage_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_derivative_backend" ADD CONSTRAINT "CHK_646e496667ff2ca9bd65894c2d" CHECK ("data" IS NOT NULL OR ("storage" IS NOT NULL AND "storage_key" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_file_backend" ADD CONSTRAINT "CHK_c4f742c1ff4954b108b800998c" CHECK ("data" IS NOT NULL OR ("storage" IS NOT NULL AND "storage_key" IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Files on disk can not be told apart from objects in a bucket anymore
    const [{ count }] = await queryRunner.query(
      `SELECT COUNT(*) AS count FROM "e_image_file_backend" WHERE "storage" = 'filesystem'`,
    );
    if (Number(count) > 0) {
      throw new Error(
        'Move the images stored on disk to the database or S3 first',
      );
    }
    await queryRunner.query(
      `DELETE FROM "e_image_derivative_backend" WHERE "storage" = 'filesystem'`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_file_backend" DROP CONSTRAINT "CHK_c4f742c1ff4954b108b800998c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_derivative_backend" DROP CONSTRAINT "CHK_646e496667ff2ca9bd65894c2d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_file_backend" DROP COLUMN "storage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_derivative_backend" DROP COLUMN "storage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_file_backend" ADD CONSTRAINT "CHK_0744bfe845dcafb19afa814835" CHECK (((data IS NOT NULL) OR (storage_key IS NOT NULL)))`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_derivative_backend" ADD CONSTRAINT "CHK_f146949e158946cbd247c482b4" CHECK (((data IS NOT NULL) OR (storage_key IS NOT NULL)))`,
    );
  }
}
