import { MigrationInterface, QueryRunner } from 'typeorm';

// Image data can be stored in object storage instead of the database
export class V060A1790293063219 implements MigrationInterface {
  name = 'V060A1790293063219';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_image_file_backend" ADD "storage_key" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_derivative_backend" ADD "storage_key" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_file_backend" ALTER COLUMN "data" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_derivative_backend" ALTER COLUMN "data" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_file_backend" ADD CONSTRAINT "CHK_0744bfe845dcafb19afa814835" CHECK ("data" IS NOT NULL OR "storage_key" IS NOT NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_derivative_backend" ADD CONSTRAINT "CHK_f146949e158946cbd247c482b4" CHECK ("data" IS NOT NULL OR "storage_key" IS NOT NULL)`,
    );
  }

  // Reverting only works once all image data is back in the database, see
  // the storage migrate command
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_image_derivative_backend" DROP CONSTRAINT "CHK_f146949e158946cbd247c482b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_file_backend" DROP CONSTRAINT "CHK_0744bfe845dcafb19afa814835"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_derivative_backend" ALTER COLUMN "data" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_file_backend" ALTER COLUMN "data" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_derivative_backend" DROP COLUMN "storage_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_file_backend" DROP COLUMN "storage_key"`,
    );
  }
}
