import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { fileTypeFromBuffer, FileTypeResult } from 'file-type';
import { ImageRequestParams } from 'picsur-shared/dist/dto/api/image.dto';
import { ImageEntryVariant } from 'picsur-shared/dist/dto/image-entry-variant.enum';
import {
  AnimFileType,
  FileType,
  FileType2Ext,
  ImageFileType,
  Mime2FileType,
} from 'picsur-shared/dist/dto/mimes.dto';
import { SysPreference } from 'picsur-shared/dist/dto/sys-preferences.enum';
import { UsrPreference } from 'picsur-shared/dist/dto/usr-preferences.enum';
import {
  AsyncFailable,
  Fail,
  Failable,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { FindResult } from 'picsur-shared/dist/types/find-result';
import { ParseFileType } from 'picsur-shared/dist/util/parse-mime';
import { ImageDBService } from '../../collections/image-db/image-db.service.js';
import {
  ImageFileDBService,
  StoredImage,
} from '../../collections/image-db/image-file-db.service.js';
import { SysPreferenceDbService } from '../../collections/preference-db/sys-preference-db.service.js';
import { UsrPreferenceDbService } from '../../collections/preference-db/usr-preference-db.service.js';
import { EImageBackend } from '../../database/entities/images/image.entity.js';
import { MutexFallBack } from '../../util/mutex-fallback.js';
import { ConversionLimiterService } from './conversion-limiter.service.js';
import { MasterDimensions } from './dimensions.js';
import { ImageConverterService } from './image-converter.service.js';
import { ImageProcessorService } from './image-processor.service.js';
import { IsQOI } from '../../workers/codecs/qoi.js';
import { IsAnimatedWebP } from './webp.js';

// Images can be resized to at most this many pixels, or their own size when
// that is larger
const MaxUpscalePixels = 4096 * 4096;
// Converted versions kept per image
const MaxDerivativesPerImage = 50;

@Injectable()
export class ImageManagerService {
  private readonly logger = new Logger(ImageManagerService.name);

  constructor(
    private readonly imagesService: ImageDBService,
    private readonly imageFilesService: ImageFileDBService,
    private readonly processService: ImageProcessorService,
    private readonly convertService: ImageConverterService,
    private readonly conversionLimiter: ConversionLimiterService,
    private readonly userPref: UsrPreferenceDbService,
    private readonly sysPref: SysPreferenceDbService,
  ) {}

  public async findOne(id: string): AsyncFailable<EImageBackend> {
    return await this.imagesService.findOne(id, undefined);
  }

  public async findMany(
    count: number,
    page: number,
    userid: string | undefined,
  ): AsyncFailable<FindResult<EImageBackend>> {
    return await this.imagesService.findMany(count, page, userid);
  }

  public async update(
    id: string,
    userid: string | undefined,
    options: Partial<
      Pick<EImageBackend, 'file_name' | 'expires_at' | 'listed'>
    >,
  ): AsyncFailable<EImageBackend> {
    if (options.expires_at !== undefined && options.expires_at !== null) {
      if (options.expires_at < new Date()) {
        return Fail(FT.UsrValidation, 'Expiration date must be in the future');
      }
    }
    return await this.imagesService.update(id, userid, options);
  }

  public async deleteMany(
    ids: string[],
    userid: string | undefined,
  ): AsyncFailable<EImageBackend[]> {
    return await this.imagesService.delete(ids, userid);
  }

  public async deleteWithKey(
    imageId: string,
    key: string,
  ): AsyncFailable<EImageBackend> {
    return await this.imagesService.deleteWithKey(imageId, key);
  }

  public async upload(
    userid: string,
    filename: string,
    image: Buffer,
    withDeleteKey: boolean,
  ): AsyncFailable<EImageBackend> {
    const fileType = await this.getFileTypeFromBuffer(image);
    if (HasFailed(fileType)) return fileType;

    // Check if need to save orignal
    const keepOriginal = await this.userPref.getBooleanPreference(
      userid,
      UsrPreference.KeepOriginal,
    );
    if (HasFailed(keepOriginal)) return keepOriginal;

    // Process
    const processResult = await this.processService.process(image, fileType);
    if (HasFailed(processResult)) return processResult;

    // Strip extension from filename
    const name = (() => {
      const index = filename.lastIndexOf('.');
      if (index === -1) return filename;
      return filename.substring(0, index);
    })();

    // Save processed to db
    const imageEntity = await this.imagesService.create(
      userid,
      name,
      withDeleteKey,
    );
    if (HasFailed(imageEntity)) return imageEntity;

    const imageFileEntity = await this.imageFilesService.setFile(
      imageEntity.id,
      ImageEntryVariant.MASTER,
      processResult.image,
      processResult.filetype,
    );
    if (HasFailed(imageFileEntity)) return imageFileEntity;

    if (keepOriginal) {
      const originalFileEntity = await this.imageFilesService.setFile(
        imageEntity.id,
        ImageEntryVariant.ORIGINAL,
        image,
        fileType.identifier,
      );
      if (HasFailed(originalFileEntity)) return originalFileEntity;
    }

    return imageEntity;
  }

  // Client identifies who asked for it, for rate limiting
  public async getConverted(
    imageId: string,
    fileType: string,
    options: ImageRequestParams,
    client: string,
  ): AsyncFailable<StoredImage> {
    const targetFileType = ParseFileType(fileType);
    if (HasFailed(targetFileType)) return targetFileType;

    const allow_editing = await this.sysPref.getBooleanPreference(
      SysPreference.AllowEditing,
    );
    if (HasFailed(allow_editing)) return allow_editing;

    // The cache key has to match what is actually rendered, otherwise an
    // unedited image would be cached for the edited parameters while editing
    // is disabled.
    const effectiveOptions: ImageRequestParams = allow_editing ? options : {};
    const converted_key = this.getConvertHash({
      mime: fileType,
      ...effectiveOptions,
    });

    return MutexFallBack(
      `${imageId}-${converted_key}`,
      () => {
        return this.imageFilesService.getDerivative(imageId, converted_key);
      },
      async () => {
        const masterImage = await this.getMaster(imageId);
        if (HasFailed(masterImage)) return masterImage;

        const sourceFileType = ParseFileType(masterImage.filetype);
        if (HasFailed(sourceFileType)) return sourceFileType;

        // Nothing to convert, serve the master as it is instead of storing
        // another copy of it. A still WebP is as much a .webp as an animated
        // one is.
        if (
          FileType2Ext(sourceFileType.identifier) ===
            FileType2Ext(targetFileType.identifier) &&
          Object.keys(effectiveOptions).length === 0
        ) {
          return masterImage;
        }

        const sizeAllowed = this.checkOutputSize(
          masterImage.data,
          effectiveOptions,
        );
        if (HasFailed(sizeAllowed)) return sizeAllowed;

        const clientAllowed = this.conversionLimiter.checkClient(client);
        if (HasFailed(clientAllowed)) return clientAllowed;

        const startTime = Date.now();
        const convertResult = await this.convertService.convert(
          masterImage.data,
          sourceFileType,
          targetFileType,
          effectiveOptions,
        );
        if (HasFailed(convertResult)) return convertResult;

        this.logger.verbose(
          `Converted ${imageId} from ${sourceFileType.identifier} to ${
            targetFileType.identifier
          } in ${Date.now() - startTime}ms`,
        );

        // Don't let a single image collect an unlimited amount of cached
        // versions, when it has plenty they are made but not kept
        const cached = await this.imageFilesService.countDerivatives(imageId);
        if (HasFailed(cached)) return cached;
        if (cached >= MaxDerivativesPerImage) {
          return {
            filetype: convertResult.filetype,
            data: convertResult.image,
          };
        }

        return await this.imageFilesService.addDerivative(
          imageId,
          converted_key,
          convertResult.filetype,
          convertResult.image,
        );
      },
    );
  }

  // Resizing is meant for getting a differently sized version of an image,
  // not for making the server render gigantic ones
  private checkOutputSize(
    master: Buffer,
    options: ImageRequestParams,
  ): Failable<true> {
    if (!options.width && !options.height) return true;

    const source = MasterDimensions(master);
    if (source === null) return true;

    let { width, height } = source;
    if (options.width && options.height) {
      width = options.width;
      height = options.height;
    } else if (options.width) {
      width = options.width;
      height = Math.max(1, Math.round((source.height * width) / source.width));
    } else if (options.height) {
      height = options.height;
      width = Math.max(1, Math.round((source.width * height) / source.height));
    }
    if (options.shrinkonly) {
      width = Math.min(width, source.width);
      height = Math.min(height, source.height);
    }

    const allowed = Math.max(source.width * source.height, MaxUpscalePixels);
    if (width * height > allowed) {
      return Fail(FT.UsrValidation, 'The requested size is too large');
    }
    return true;
  }

  // File getters ==============================================================

  public async getMaster(imageId: string): AsyncFailable<StoredImage> {
    return this.imageFilesService.getFile(imageId, ImageEntryVariant.MASTER);
  }

  public async getMasterFileType(imageId: string): AsyncFailable<FileType> {
    const mime = await this.imageFilesService.getFileTypes(imageId);
    if (HasFailed(mime)) return mime;

    if (mime['master'] === undefined)
      return Fail(FT.NotFound, 'No master file');

    return ParseFileType(mime['master']);
  }

  public async getOriginal(imageId: string): AsyncFailable<StoredImage> {
    return this.imageFilesService.getFile(imageId, ImageEntryVariant.ORIGINAL);
  }

  public async getOriginalFileType(imageId: string): AsyncFailable<FileType> {
    const filetypes = await this.imageFilesService.getFileTypes(imageId);
    if (HasFailed(filetypes)) return filetypes;

    if (filetypes['original'] === undefined)
      return Fail(FT.NotFound, 'No original file');

    return ParseFileType(filetypes['original']);
  }

  public async getFileMimes(imageId: string): AsyncFailable<{
    [ImageEntryVariant.MASTER]: string;
    [ImageEntryVariant.ORIGINAL]: string | undefined;
  }> {
    const result = await this.imageFilesService.getFileTypes(imageId);
    if (HasFailed(result)) return result;

    if (result[ImageEntryVariant.MASTER] === undefined) {
      return Fail(FT.NotFound, 'No master file found');
    }

    return {
      [ImageEntryVariant.MASTER]: result[ImageEntryVariant.MASTER],
      [ImageEntryVariant.ORIGINAL]: result[ImageEntryVariant.ORIGINAL],
    };
  }

  // Util stuff ==================================================================

  private async getFileTypeFromBuffer(image: Buffer): AsyncFailable<FileType> {
    const filetypeResult: FileTypeResult | undefined =
      await fileTypeFromBuffer(image);

    let mime: string | undefined;
    if (filetypeResult === undefined) {
      if (IsQOI(image)) mime = 'image/x-qoi';
    } else {
      mime = filetypeResult.mime;
    }

    if (mime === undefined) mime = 'other/unknown';

    let filetype: string | undefined;
    if (mime === 'image/webp') {
      if (IsAnimatedWebP(image)) filetype = AnimFileType.WEBP;
      else filetype = ImageFileType.WEBP;
    }
    if (filetype === undefined) {
      const parsed = Mime2FileType(mime);
      if (HasFailed(parsed)) {
        return Fail(
          FT.UsrValidation,
          'Unsupported file type',
          parsed.getReason(),
        );
      }
      filetype = parsed;
    }

    return ParseFileType(filetype);
  }

  private getConvertHash(options: object) {
    // Return a sha256 hash of the stringified options
    const stringified = JSON.stringify(options);
    const hash = createHash('sha256');
    hash.update(stringified);
    const digest = hash.digest('hex');
    return digest;
  }
}
