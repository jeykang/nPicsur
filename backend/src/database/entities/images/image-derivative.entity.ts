import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { EImageBackend } from './image.entity.js';

@Entity()
@Unique(['image_id', 'key'])
@Check(`"data" IS NOT NULL OR "storage_key" IS NOT NULL`)
export class EImageDerivativeBackend {
  @PrimaryGeneratedColumn('uuid')
  private _id?: string;

  // We do a little trickery
  @Index()
  @ManyToOne(() => EImageBackend, (image) => image.derivatives, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'image_id' })
  private _image?: any;

  @Column({
    name: 'image_id',
  })
  image_id: string;

  @Index()
  @Column({ nullable: false })
  key: string;

  @Column({ nullable: false })
  filetype: string;

  @Column({
    type: 'timestamptz',
    name: 'last_read',
    nullable: false,
  })
  last_read: Date;

  // The converted image, when it is stored in the database. Never loaded
  // unless explicitly asked for, it can be large.
  @Column({ type: 'bytea', nullable: true, select: false })
  data?: Buffer | null;

  // Where the converted image is stored instead, when it lives in object
  // storage
  @Column({ type: 'varchar', nullable: true })
  storage_key: string | null;
}
