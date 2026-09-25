import { MigrationInterface, QueryRunner } from 'typeorm';

// Login tokens can be revoked by changing the password
export class V060B1790297214057 implements MigrationInterface {
  name = 'V060B1790297214057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_user_backend" ADD "tokens_valid_after" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_user_backend" DROP COLUMN "tokens_valid_after"`,
    );
  }
}
