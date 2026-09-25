import { Body, Controller, Post } from '@nestjs/common';
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
} from 'picsur-shared/dist/dto/api/album.dto';
import { ThrowIfFailed } from 'picsur-shared/dist/types/failable';
import { AlbumDbService } from '../../../collections/album-db/album-db.service.js';
import { UserDbService } from '../../../collections/user-db/user-db.service.js';
import { EasyThrottle } from '../../../decorators/easy-throttle.decorator.js';
import {
  HasPermission,
  RequiredPermissions,
} from '../../../decorators/permissions.decorator.js';
import { ReqUserID } from '../../../decorators/request-user.decorator.js';
import { Returns } from '../../../decorators/returns.decorator.js';
import { Permission } from '../../../models/constants/permissions.const.js';

// Albums can be seen by anyone who can see images and has their link, like
// images themselves. Only their owner, or an image admin, can change them.
@Controller('api/album')
export class AlbumController {
  constructor(
    private readonly albumDB: AlbumDbService,
    private readonly userDB: UserDbService,
  ) {}

  @Post('create')
  @RequiredPermissions(Permission.ImageManage)
  @Returns(AlbumCreateResponse)
  @EasyThrottle(30)
  async create(
    @Body() body: AlbumCreateRequest,
    @ReqUserID() userid: string,
  ): Promise<AlbumCreateResponse> {
    return ThrowIfFailed(await this.albumDB.create(userid, body.name));
  }

  @Post('list')
  @RequiredPermissions(Permission.ImageManage)
  @Returns(AlbumListResponse)
  async list(
    @Body() body: AlbumListRequest,
    @ReqUserID() userid: string,
    @HasPermission(Permission.ImageAdmin) isImageAdmin: boolean,
  ): Promise<AlbumListResponse> {
    const owner = isImageAdmin ? (body.user_id ?? userid) : userid;
    return ThrowIfFailed(
      await this.albumDB.findMany(body.count, body.page, owner, body.image_id),
    );
  }

  @Post('info')
  @RequiredPermissions(Permission.ImageView)
  @Returns(AlbumInfoResponse)
  async info(@Body() body: AlbumInfoRequest): Promise<AlbumInfoResponse> {
    const album = ThrowIfFailed(
      await this.albumDB.findSummary(body.id, undefined),
    );
    const user = ThrowIfFailed(await this.userDB.findOne(album.user_id));
    return { album, user: { id: user.id, username: user.username } };
  }

  @Post('images')
  @RequiredPermissions(Permission.ImageView)
  @Returns(AlbumImagesResponse)
  async images(@Body() body: AlbumImagesRequest): Promise<AlbumImagesResponse> {
    return ThrowIfFailed(
      await this.albumDB.findImages(body.id, body.count, body.page),
    );
  }

  @Post('update')
  @RequiredPermissions(Permission.ImageManage)
  @Returns(AlbumUpdateResponse)
  async update(
    @Body() body: AlbumUpdateRequest,
    @ReqUserID() userid: string,
    @HasPermission(Permission.ImageAdmin) isImageAdmin: boolean,
  ): Promise<AlbumUpdateResponse> {
    return ThrowIfFailed(
      await this.albumDB.rename(
        body.id,
        isImageAdmin ? undefined : userid,
        body.name,
      ),
    );
  }

  @Post('delete')
  @RequiredPermissions(Permission.ImageManage)
  @Returns(AlbumDeleteResponse)
  async delete(
    @Body() body: AlbumDeleteRequest,
    @ReqUserID() userid: string,
    @HasPermission(Permission.ImageAdmin) isImageAdmin: boolean,
  ): Promise<AlbumDeleteResponse> {
    return ThrowIfFailed(
      await this.albumDB.delete(body.id, isImageAdmin ? undefined : userid),
    );
  }

  @Post('images/add')
  @RequiredPermissions(Permission.ImageManage)
  @Returns(AlbumChangeImagesResponse)
  async addImages(
    @Body() body: AlbumChangeImagesRequest,
    @ReqUserID() userid: string,
    @HasPermission(Permission.ImageAdmin) isImageAdmin: boolean,
  ): Promise<AlbumChangeImagesResponse> {
    return ThrowIfFailed(
      await this.albumDB.addImages(
        body.id,
        isImageAdmin ? undefined : userid,
        body.image_ids,
      ),
    );
  }

  @Post('images/remove')
  @RequiredPermissions(Permission.ImageManage)
  @Returns(AlbumChangeImagesResponse)
  async removeImages(
    @Body() body: AlbumChangeImagesRequest,
    @ReqUserID() userid: string,
    @HasPermission(Permission.ImageAdmin) isImageAdmin: boolean,
  ): Promise<AlbumChangeImagesResponse> {
    return ThrowIfFailed(
      await this.albumDB.removeImages(
        body.id,
        isImageAdmin ? undefined : userid,
        body.image_ids,
      ),
    );
  }
}
