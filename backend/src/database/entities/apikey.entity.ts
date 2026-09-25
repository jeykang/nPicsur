import { EApiKeySchema } from 'picsur-shared/dist/entities/apikey.entity';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { z } from 'zod';
import { EUserBackend } from './users/user.entity.js';

const OverriddenEApiKeySchema = EApiKeySchema.omit({ user: true }).merge(
  z.object({
    user: z.string().or(z.object({})),
  }),
);
type OverriddenEApiKey = z.infer<typeof OverriddenEApiKeySchema>;

@Entity()
export class EApiKeyBackend<
  T extends string | EUserBackend = string | EUserBackend,
> implements OverriddenEApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Only a hash of the key is stored, so the keys can not be taken from the
  // database
  @Column({
    nullable: false,
    unique: true,
    select: false,
  })
  key_hash?: string;

  @Column({ nullable: false })
  key_hint: string;

  @ManyToOne(() => EUserBackend, (user) => user.apikeys, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  user: T;

  @Column({ nullable: false })
  name: string;

  @Column({
    type: 'timestamptz',
    nullable: false,
  })
  created: Date;

  @Column({
    type: 'timestamptz',
    nullable: true,
  })
  last_used: Date;
}
