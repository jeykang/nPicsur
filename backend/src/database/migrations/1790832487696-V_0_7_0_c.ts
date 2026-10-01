import { MigrationInterface, QueryRunner } from 'typeorm';

export class V070C1790832487696 implements MigrationInterface {
  name = 'V070C1790832487696';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "e_user_oidc_backend" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "issuer" character varying NOT NULL, "subject" character varying NOT NULL, "user_id" uuid NOT NULL, "name" character varying, "created" TIMESTAMP WITH TIME ZONE NOT NULL, "last_login" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_1aca2df3319d7a7c958c184394f" UNIQUE ("user_id", "issuer"), CONSTRAINT "UQ_a6cec950b542cf23fc179d2f667" UNIQUE ("issuer", "subject"), CONSTRAINT "PK_8fbcd9c316eb3121484eb021d24" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0b4fd228c9f3690d43bab588c7" ON "e_user_oidc_backend" ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "e_user_backend" ALTER COLUMN "hashed_password" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_user_oidc_backend" ADD CONSTRAINT "FK_0b4fd228c9f3690d43bab588c7e" FOREIGN KEY ("user_id") REFERENCES "e_user_backend"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Users without a password could not log in anymore
    const [{ count }] = await queryRunner.query(
      `SELECT COUNT(*) AS count FROM "e_user_backend" WHERE "hashed_password" IS NULL`,
    );
    if (Number(count) > 0) {
      throw new Error(
        'Give the users who only log in with OpenID Connect a password first',
      );
    }
    await queryRunner.query(
      `ALTER TABLE "e_user_oidc_backend" DROP CONSTRAINT "FK_0b4fd228c9f3690d43bab588c7e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_user_backend" ALTER COLUMN "hashed_password" SET NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0b4fd228c9f3690d43bab588c7"`,
    );
    await queryRunner.query(`DROP TABLE "e_user_oidc_backend"`);
  }
}
