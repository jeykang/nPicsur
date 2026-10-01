import { EImage } from 'picsur-shared/dist/entities/image.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class EImageBackend implements EImage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({
    nullable: false,
    type: 'uuid',
  })
  user_id: string;

  @Column({
    type: 'timestamptz',
    nullable: false,
  })
  created: Date;

  @Column({
    nullable: false,
    default: 'image',
  })
  file_name: string;

  @Column({
    type: 'timestamptz',
    nullable: true,
  })
  expires_at: Date | null;

  @Column({
    nullable: true,
    select: false,
  })
  delete_key?: string;

  // Shown in the public gallery
  @Index()
  @Column({ nullable: false, default: false })
  listed: boolean;
}
