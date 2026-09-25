import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EUserBackend } from '../users/user.entity.js';

@Entity()
export class EAlbumBackend {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Albums are deleted along with their user
  @Index()
  @ManyToOne(() => EUserBackend, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  private _user?: any;

  @Column({ name: 'user_id' })
  user_id: string;

  @Column({ nullable: false })
  name: string;

  @Column({
    type: 'timestamptz',
    nullable: false,
  })
  created: Date;
}
