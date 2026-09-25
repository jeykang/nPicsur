import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AsyncFailable, Fail, FT } from 'picsur-shared/dist/types/failable';
import { FindResult } from 'picsur-shared/dist/types/find-result';
import { generateRandomString } from 'picsur-shared/dist/util/random';
import { EntityManager, In, LessThan, Repository } from 'typeorm';
import { EImageBackend } from '../../database/entities/images/image.entity.js';
import { EUserBackend } from '../../database/entities/users/user.entity.js';
import { ImageFileDBService } from './image-file-db.service.js';

// Deleting an image deletes its rows first, and only then the data in object
// storage (if any). A failure halfway leaves unused objects behind, instead
// of images that are still listed but broken.
@Injectable()
export class ImageDBService {
  constructor(
    @InjectRepository(EImageBackend)
    private readonly imageRepo: Repository<EImageBackend>,
    private readonly imageFiles: ImageFileDBService,
  ) {}

  public async create(
    userid: string,
    filename: string,
    withDeleteKey: boolean,
  ): AsyncFailable<EImageBackend> {
    let imageEntity = new EImageBackend();
    imageEntity.user_id = userid;
    imageEntity.created = new Date();
    imageEntity.file_name = filename;
    if (withDeleteKey) imageEntity.delete_key = generateRandomString(32);

    try {
      imageEntity = await this.imageRepo.save(imageEntity, {
        reload: true,
      });

      if (imageEntity.delete_key === null) delete imageEntity.delete_key;
      return imageEntity;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async findOne(
    id: string,
    userid: string | undefined,
  ): AsyncFailable<EImageBackend> {
    try {
      const found = await this.imageRepo.findOne({
        where: { id, user_id: userid },
      });

      if (!found) return Fail(FT.NotFound, 'Image not found');
      return found;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async findMany(
    count: number,
    page: number,
    userid: string | undefined,
  ): AsyncFailable<FindResult<EImageBackend>> {
    if (count < 1 || page < 0) return Fail(FT.UsrValidation, 'Invalid page');
    if (count > 100) return Fail(FT.UsrValidation, 'Too many results');

    try {
      const [found, amount] = await this.imageRepo.findAndCount({
        skip: count * page,
        take: count,
        order: { created: 'DESC' },
        where: {
          user_id: userid,
        },
      });

      if (found === undefined) return Fail(FT.NotFound, 'Images not found');

      return {
        results: found,
        total: amount,
        page,
        pages: Math.ceil(amount / count),
      };
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async count(): AsyncFailable<number> {
    try {
      return await this.imageRepo.count();
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async update(
    id: string,
    userid: string | undefined,
    options: Partial<Pick<EImageBackend, 'file_name' | 'expires_at'>>,
  ): AsyncFailable<EImageBackend> {
    try {
      const found = await this.imageRepo.findOne({
        where: { id, user_id: userid },
      });

      if (!found) return Fail(FT.NotFound, 'Image not found');

      if (options.file_name !== undefined) found.file_name = options.file_name;

      if (options.expires_at !== undefined)
        found.expires_at = options.expires_at;

      await this.imageRepo.save(found);

      return found;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async delete(
    ids: string[],
    userid: string | undefined,
  ): AsyncFailable<EImageBackend[]> {
    if (ids.length === 0) return [];
    if (ids.length > 500) return Fail(FT.UsrValidation, 'Too many results');

    let deletable_images: EImageBackend[];
    try {
      deletable_images = await this.imageRepo.find({
        where: {
          id: In(ids),
          user_id: userid,
        },
      });
    } catch (e) {
      return Fail(FT.Database, e);
    }

    const available_ids = deletable_images.map((i) => i.id);
    if (available_ids.length === 0)
      return Fail(FT.NotFound, 'Images not found');

    try {
      await this.imageRepo.delete({ id: In(available_ids) });
    } catch (e) {
      return Fail(FT.Database, e);
    }

    await this.imageFiles.deleteStoredData(available_ids);
    return deletable_images;
  }

  public async deleteWithKey(
    id: string,
    key: string,
  ): AsyncFailable<EImageBackend> {
    try {
      const found = await this.imageRepo.findOne({
        where: { id, delete_key: key },
      });

      if (!found) return Fail(FT.NotFound, 'Image not found');

      await this.imageRepo.delete({ id: found.id });

      await this.imageFiles.deleteStoredData([found.id]);
      return found;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async deleteAll(IAmSure: boolean): AsyncFailable<true> {
    if (!IAmSure)
      return Fail(
        FT.SysValidation,
        'You must confirm that you want to delete all images',
      );

    try {
      await this.imageRepo.delete({});
    } catch (e) {
      return Fail(FT.Database, e);
    }

    await this.imageFiles.deleteStoredData('all');
    return true;
  }

  // Deletes the rows of every image of a user, as part of the transaction
  // the entity manager belongs to, and returns their ids. Their data in
  // object storage still has to be deleted with deleteStoredData once the
  // transaction is committed. Errors are thrown, to roll the transaction
  // back.
  public async deleteRowsOfUser(
    userid: string,
    manager: EntityManager,
  ): Promise<string[]> {
    const result = await manager
      .createQueryBuilder()
      .delete()
      .from(EImageBackend)
      .where({ user_id: userid })
      .returning(['id'])
      .execute();
    return (result.raw as { id: string }[]).map((image) => image.id);
  }

  // Counts the images of users that no longer exist, per user. Picsur 0.5
  // kept the images of deleted users.
  public async countOrphaned(): AsyncFailable<Map<string, number>> {
    try {
      const rows: { user_id: string; count: string }[] = await this.imageRepo
        .createQueryBuilder('image')
        .select('image.user_id', 'user_id')
        .addSelect('COUNT(*)', 'count')
        .where(this.orphanedCondition('image'))
        .groupBy('image.user_id')
        .getRawMany();
      return new Map(rows.map((row) => [row.user_id, Number(row.count)]));
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  // Deletes the images of users that no longer exist
  public async deleteOrphaned(): AsyncFailable<number> {
    let deleted: { id: string }[];
    try {
      const result = await this.imageRepo
        .createQueryBuilder()
        .delete()
        .where(this.orphanedCondition(this.imageRepo.metadata.tableName))
        .returning(['id'])
        .execute();
      deleted = result.raw;
    } catch (e) {
      return Fail(FT.Database, e);
    }

    await this.imageFiles.deleteStoredData(deleted.map((image) => image.id));
    return deleted.length;
  }

  private orphanedCondition(imageAlias: string): string {
    const users = this.imageRepo.manager.connection.getMetadata(EUserBackend);
    return `NOT EXISTS (SELECT 1 FROM "${users.tableName}" "owner" WHERE "owner"."id" = "${imageAlias}"."user_id")`;
  }

  public async cleanupExpired(): AsyncFailable<number> {
    let deleted: { id: string }[];
    try {
      const result = await this.imageRepo
        .createQueryBuilder()
        .delete()
        .where({ expires_at: LessThan(new Date()) })
        .returning(['id'])
        .execute();
      deleted = result.raw;
    } catch (e) {
      return Fail(FT.Database, e);
    }

    await this.imageFiles.deleteStoredData(deleted.map((image) => image.id));
    return deleted.length;
  }
}
