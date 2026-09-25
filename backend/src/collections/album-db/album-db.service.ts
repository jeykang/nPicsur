import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EAlbumSummary } from 'picsur-shared/dist/dto/api/album.dto';
import { EAlbum } from 'picsur-shared/dist/entities/album.entity';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { FindResult } from 'picsur-shared/dist/types/find-result';
import { In, QueryFailedError, Repository } from 'typeorm';
import { EAlbumImageBackend } from '../../database/entities/albums/album-image.entity.js';
import { EAlbumBackend } from '../../database/entities/albums/album.entity.js';
import { EImageBackend } from '../../database/entities/images/image.entity.js';

// Expired images are left out, they are about to be deleted
const NotExpired = '(image.expires_at IS NULL OR image.expires_at > :now)';

@Injectable()
export class AlbumDbService {
  constructor(
    @InjectRepository(EAlbumBackend)
    private readonly albumRepo: Repository<EAlbumBackend>,
    @InjectRepository(EAlbumImageBackend)
    private readonly albumImageRepo: Repository<EAlbumImageBackend>,
  ) {}

  public async create(
    userid: string,
    name: string,
  ): AsyncFailable<EAlbumSummary> {
    const album = new EAlbumBackend();
    album.user_id = userid;
    album.name = name;
    album.created = new Date();

    try {
      const saved = await this.albumRepo.save(album);
      return { ...ToEAlbum(saved), image_count: 0, cover_id: null };
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  // With a userid, only albums of that user are found
  public async findOne(
    id: string,
    userid: string | undefined,
  ): AsyncFailable<EAlbumBackend> {
    try {
      const found = await this.albumRepo.findOne({
        where: { id, user_id: userid },
      });
      if (!found) return Fail(FT.NotFound, 'Album not found');
      return found;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async findSummary(
    id: string,
    userid: string | undefined,
  ): AsyncFailable<EAlbumSummary> {
    const album = await this.findOne(id, userid);
    if (HasFailed(album)) return album;
    return this.summarizeOne(album);
  }

  public async findMany(
    count: number,
    page: number,
    userid: string | undefined,
    imageId?: string,
  ): AsyncFailable<FindResult<EAlbumSummary>> {
    if (count < 1 || page < 0) return Fail(FT.UsrValidation, 'Invalid page');
    if (count > 100) return Fail(FT.UsrValidation, 'Too many results');

    try {
      const [found, amount] = await this.albumRepo.findAndCount({
        where: { user_id: userid },
        order: { created: 'DESC' },
        skip: count * page,
        take: count,
      });

      return {
        results: await this.summarize(found, imageId),
        total: amount,
        page,
        pages: Math.ceil(amount / count),
      };
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  // The images added last come first
  public async findImages(
    id: string,
    count: number,
    page: number,
  ): AsyncFailable<FindResult<EImageBackend>> {
    if (count < 1 || page < 0) return Fail(FT.UsrValidation, 'Invalid page');
    if (count > 100) return Fail(FT.UsrValidation, 'Too many results');

    try {
      const [found, amount] = await this.albumRepo.manager
        .getRepository(EImageBackend)
        .createQueryBuilder('image')
        .innerJoin(EAlbumImageBackend, 'entry', 'entry.image_id = image.id')
        .where('entry.album_id = :id', { id })
        .andWhere(NotExpired, { now: new Date() })
        .orderBy('entry.added', 'DESC')
        .offset(count * page)
        .limit(count)
        .getManyAndCount();

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

  public async rename(
    id: string,
    userid: string | undefined,
    name: string,
  ): AsyncFailable<EAlbumSummary> {
    const album = await this.findOne(id, userid);
    if (HasFailed(album)) return album;

    try {
      album.name = name;
      await this.albumRepo.save(album);
    } catch (e) {
      return Fail(FT.Database, e);
    }
    return this.summarizeOne(album);
  }

  // The images in it stay
  public async delete(
    id: string,
    userid: string | undefined,
  ): AsyncFailable<EAlbum> {
    const album = await this.findOne(id, userid);
    if (HasFailed(album)) return album;

    try {
      await this.albumRepo.delete({ id: album.id });
    } catch (e) {
      return Fail(FT.Database, e);
    }
    return ToEAlbum(album);
  }

  // Only images of the album's owner are added, those already in it are
  // skipped
  public async addImages(
    id: string,
    userid: string | undefined,
    imageIds: string[],
  ): AsyncFailable<EAlbumSummary> {
    const album = await this.findOne(id, userid);
    if (HasFailed(album)) return album;

    try {
      const found = await this.albumRepo.manager
        .getRepository(EImageBackend)
        .find({
          where: { id: In(imageIds), user_id: album.user_id },
          select: ['id'],
        });
      const foundIds = new Set(found.map((image) => image.id));
      const toAdd = [...new Set(imageIds)].filter((id) => foundIds.has(id));
      if (toAdd.length === 0) return Fail(FT.NotFound, 'Images not found');

      // In the order they were given, the last one ends up first
      const now = Date.now();
      await this.albumImageRepo
        .createQueryBuilder()
        .insert()
        .values(
          toAdd.map((imageId, i) => ({
            album_id: album.id,
            image_id: imageId,
            added: new Date(now + i),
          })),
        )
        .orIgnore()
        .execute();
    } catch (e) {
      // An image or the album was deleted in the meantime
      if (
        e instanceof QueryFailedError &&
        (e as any).driverError?.code === '23503'
      ) {
        return Fail(FT.NotFound, 'Images not found');
      }
      return Fail(FT.Database, e);
    }

    return this.summarizeOne(album);
  }

  public async removeImages(
    id: string,
    userid: string | undefined,
    imageIds: string[],
  ): AsyncFailable<EAlbumSummary> {
    const album = await this.findOne(id, userid);
    if (HasFailed(album)) return album;

    try {
      await this.albumImageRepo.delete({
        album_id: album.id,
        image_id: In(imageIds),
      });
    } catch (e) {
      return Fail(FT.Database, e);
    }
    return this.summarizeOne(album);
  }

  private async summarizeOne(
    album: EAlbumBackend,
  ): AsyncFailable<EAlbumSummary> {
    try {
      return (await this.summarize([album]))[0];
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  // Adds how many images each album has, and the one added last as cover
  private async summarize(
    albums: EAlbumBackend[],
    imageId?: string,
  ): Promise<EAlbumSummary[]> {
    if (albums.length === 0) return [];
    const ids = albums.map((album) => album.id);

    const entries = () =>
      this.albumImageRepo
        .createQueryBuilder('entry')
        .innerJoin(EImageBackend, 'image', 'image.id = entry.image_id')
        .where('entry.album_id IN (:...ids)', { ids })
        .andWhere(NotExpired, { now: new Date() });

    const counts: { album_id: string; count: string }[] = await entries()
      .select('entry.album_id', 'album_id')
      .addSelect('COUNT(*)', 'count')
      .groupBy('entry.album_id')
      .getRawMany();
    const covers: { album_id: string; image_id: string }[] = await entries()
      .select('entry.album_id', 'album_id')
      .addSelect('entry.image_id', 'image_id')
      .distinctOn(['entry.album_id'])
      .orderBy('entry.album_id')
      .addOrderBy('entry.added', 'DESC')
      .getRawMany();

    let containing: Set<string> | undefined;
    if (imageId !== undefined) {
      const rows = await this.albumImageRepo.find({
        where: { album_id: In(ids), image_id: imageId },
        select: ['album_id'],
      });
      containing = new Set(rows.map((row) => row.album_id));
    }

    const countById = new Map(counts.map((c) => [c.album_id, Number(c.count)]));
    const coverById = new Map(covers.map((c) => [c.album_id, c.image_id]));
    return albums.map((album) => ({
      ...ToEAlbum(album),
      image_count: countById.get(album.id) ?? 0,
      cover_id: coverById.get(album.id) ?? null,
      ...(containing ? { contains_image: containing.has(album.id) } : {}),
    }));
  }
}

function ToEAlbum(album: EAlbumBackend): EAlbum {
  return {
    id: album.id,
    user_id: album.user_id,
    name: album.name,
    created: album.created,
  };
}
