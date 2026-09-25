import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { EImageBackend } from '../images/image.entity.js';
import { EAlbumBackend } from './album.entity.js';

// An image in an album, removed when either of them is deleted
@Entity()
export class EAlbumImageBackend {
  @PrimaryColumn({ name: 'album_id', type: 'uuid' })
  album_id: string;

  @PrimaryColumn({ name: 'image_id', type: 'uuid' })
  image_id: string;

  @ManyToOne(() => EAlbumBackend, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'album_id' })
  private _album?: any;

  @Index()
  @ManyToOne(() => EImageBackend, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'image_id' })
  private _image?: any;

  @Column({
    type: 'timestamptz',
    nullable: false,
  })
  added: Date;
}
