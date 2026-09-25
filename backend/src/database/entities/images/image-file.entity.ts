import { ImageEntryVariant } from 'picsur-shared/dist/dto/image-entry-variant.enum';
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
@Unique(['image_id', 'variant'])
@Check(`"data" IS NOT NULL OR "storage_key" IS NOT NULL`)
export class EImageFileBackend {
  @PrimaryGeneratedColumn('uuid')
  private _id?: string;

  // We do a little trickery
  @Index()
  @ManyToOne(() => EImageBackend, (image) => image.files, {
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
  @Column({ nullable: false, enum: ImageEntryVariant })
  variant: ImageEntryVariant;

  @Column({ nullable: false })
  filetype: string;

  // The image itself, when it is stored in the database. Never loaded unless
  // explicitly asked for, it can be large.
  @Column({ type: 'bytea', nullable: true, select: false })
  data?: Buffer | null;

  // Where the image is stored instead, when it lives in object storage
  @Column({ type: 'varchar', nullable: true })
  storage_key: string | null;
}
