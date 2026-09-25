import { MigrationInterface, QueryRunner } from 'typeorm';

// Albums of images, deleted along with their user
export class V060E1790335611280 implements MigrationInterface {
  name = 'V060E1790335611280';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "e_album_backend" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "name" character varying NOT NULL, "created" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_c8bc22bb8a7d44f7837aed1f17d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_34ea998ddf0fb3e2ccc61e9abe" ON "e_album_backend" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "e_album_image_backend" ("album_id" uuid NOT NULL, "image_id" uuid NOT NULL, "added" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_b7fccb39457575a379766c250a2" PRIMARY KEY ("album_id", "image_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_daee2dcc90836c603a4943473a" ON "e_album_image_backend" ("image_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "e_album_backend" ADD CONSTRAINT "FK_34ea998ddf0fb3e2ccc61e9abe5" FOREIGN KEY ("user_id") REFERENCES "e_user_backend"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_album_image_backend" ADD CONSTRAINT "FK_107946f6fdf895ed628ceffd3b3" FOREIGN KEY ("album_id") REFERENCES "e_album_backend"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_album_image_backend" ADD CONSTRAINT "FK_daee2dcc90836c603a4943473a5" FOREIGN KEY ("image_id") REFERENCES "e_image_backend"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_album_image_backend" DROP CONSTRAINT "FK_daee2dcc90836c603a4943473a5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_album_image_backend" DROP CONSTRAINT "FK_107946f6fdf895ed628ceffd3b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_album_backend" DROP CONSTRAINT "FK_34ea998ddf0fb3e2ccc61e9abe5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_daee2dcc90836c603a4943473a"`,
    );
    await queryRunner.query(`DROP TABLE "e_album_image_backend"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_34ea998ddf0fb3e2ccc61e9abe"`,
    );
    await queryRunner.query(`DROP TABLE "e_album_backend"`);
  }
}
