import { EUser } from 'picsur-shared/dist/entities/user.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class EUserBackend implements EUser {
  @PrimaryGeneratedColumn('uuid', {})
  id: string;

  @Index()
  @Column({ nullable: false, unique: true })
  username: string;

  @Column('text', { nullable: false, array: true })
  roles: string[];

  // Null for users who only log in with an OpenID Connect provider
  @Column({ type: 'varchar', nullable: true, select: false })
  hashed_password?: string | null;

  // Login tokens issued before this are no longer accepted. It is set when
  // the password changes, so whoever had the old one is logged out.
  @Column({ type: 'timestamptz', nullable: true })
  tokens_valid_after?: Date | null;
}
