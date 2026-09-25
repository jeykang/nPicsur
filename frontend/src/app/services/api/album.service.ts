import { Injectable } from '@angular/core';
import {
  AlbumChangeImagesRequest,
  AlbumChangeImagesResponse,
  AlbumCreateRequest,
  AlbumCreateResponse,
  AlbumDeleteRequest,
  AlbumDeleteResponse,
  AlbumImagesRequest,
  AlbumImagesResponse,
  AlbumInfoRequest,
  AlbumInfoResponse,
  AlbumListRequest,
  AlbumListResponse,
  AlbumUpdateRequest,
  AlbumUpdateResponse,
  EAlbumSummary,
} from 'picsur-shared/dist/dto/api/album.dto';
import { EAlbum } from 'picsur-shared/dist/entities/album.entity';
import { AsyncFailable } from 'picsur-shared/dist/types/failable';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root',
})
export class AlbumService {
  constructor(private readonly api: ApiService) {}

  public async create(name: string): AsyncFailable<EAlbumSummary> {
    return await this.api.post(
      AlbumCreateRequest,
      AlbumCreateResponse,
      '/api/album/create',
      { name },
    ).result;
  }

  // Your own albums, and whether they hold the image, if one is given
  public async list(
    count: number,
    page: number,
    imageId?: string,
  ): AsyncFailable<AlbumListResponse> {
    return await this.api.post(
      AlbumListRequest,
      AlbumListResponse,
      '/api/album/list',
      { count, page, image_id: imageId },
    ).result;
  }

  public async info(id: string): AsyncFailable<AlbumInfoResponse> {
    return await this.api.post(
      AlbumInfoRequest,
      AlbumInfoResponse,
      '/api/album/info',
      { id },
    ).result;
  }

  public async images(
    id: string,
    count: number,
    page: number,
  ): AsyncFailable<AlbumImagesResponse> {
    return await this.api.post(
      AlbumImagesRequest,
      AlbumImagesResponse,
      '/api/album/images',
      { id, count, page },
    ).result;
  }

  public async rename(id: string, name: string): AsyncFailable<EAlbumSummary> {
    return await this.api.post(
      AlbumUpdateRequest,
      AlbumUpdateResponse,
      '/api/album/update',
      { id, name },
    ).result;
  }

  public async delete(id: string): AsyncFailable<EAlbum> {
    return await this.api.post(
      AlbumDeleteRequest,
      AlbumDeleteResponse,
      '/api/album/delete',
      { id },
    ).result;
  }

  public async addImages(
    id: string,
    imageIds: string[],
  ): AsyncFailable<EAlbumSummary> {
    return await this.api.post(
      AlbumChangeImagesRequest,
      AlbumChangeImagesResponse,
      '/api/album/images/add',
      { id, image_ids: imageIds },
    ).result;
  }

  public async removeImages(
    id: string,
    imageIds: string[],
  ): AsyncFailable<EAlbumSummary> {
    return await this.api.post(
      AlbumChangeImagesRequest,
      AlbumChangeImagesResponse,
      '/api/album/images/remove',
      { id, image_ids: imageIds },
    ).result;
  }
}
