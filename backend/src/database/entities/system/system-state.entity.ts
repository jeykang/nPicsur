import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const SystemStateTable = 'e_system_state_backend';

@Entity({ name: SystemStateTable })
export class ESystemStateBackend {
  @PrimaryGeneratedColumn('uuid')
  id?: string;

  @Index()
  @Column({ type: 'varchar', nullable: false, unique: true })
  key: string;

  @Column({ type: 'varchar', nullable: false })
  value: string;
}
