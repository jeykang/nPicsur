import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { EUserBackend } from './user.entity.js';

// A login at an OpenID Connect provider that is linked to a user here. The
// provider knows it by the subject it gives it, which never changes, unlike a
// username or email address. Only the issuer tells subjects of different
// providers apart.
@Entity()
@Unique(['issuer', 'subject'])
@Unique(['user_id', 'issuer'])
export class EUserOidcBackend {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false })
  issuer: string;

  @Column({ nullable: false })
  subject: string;

  @Index()
  @ManyToOne(() => EUserBackend, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  private _user?: any;

  @Column({ name: 'user_id' })
  user_id: string;

  // What the provider called the user when they last logged in, to show
  // which login is linked
  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Column({ type: 'timestamptz', nullable: false })
  created: Date;

  @Column({ type: 'timestamptz', nullable: true })
  last_login: Date | null;
}
