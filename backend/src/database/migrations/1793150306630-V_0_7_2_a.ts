import { MigrationInterface, QueryRunner } from 'typeorm';

// TypeORM 1 names check constraints differently, as it no longer escapes
// them with encodeURIComponent before hashing. Renaming them keeps it from
// dropping and adding them again, and from putting that in new migrations.
export class V072A1793150306630 implements MigrationInterface {
  name = 'V072A1793150306630';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_image_file_backend" RENAME CONSTRAINT "CHK_c4f742c1ff4954b108b800998c" TO "CHK_86d5a63f364f363da17a48c1e1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_derivative_backend" RENAME CONSTRAINT "CHK_646e496667ff2ca9bd65894c2d" TO "CHK_fd9bc9660c03b52bbaf71a1aee"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_image_derivative_backend" RENAME CONSTRAINT "CHK_fd9bc9660c03b52bbaf71a1aee" TO "CHK_646e496667ff2ca9bd65894c2d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_file_backend" RENAME CONSTRAINT "CHK_86d5a63f364f363da17a48c1e1" TO "CHK_c4f742c1ff4954b108b800998c"`,
    );
  }
}
