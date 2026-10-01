import { Injectable } from '@nestjs/common';
import { ImageRequestParams } from 'picsur-shared/dist/dto/api/image.dto';
import {
  AnimFileType,
  FileType,
  ImageFileType,
  SupportedFileTypeCategory,
} from 'picsur-shared/dist/dto/mimes.dto';
import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { ParseFileType } from 'picsur-shared/dist/util/parse-mime';
import { SharpOptions } from 'sharp';
import {
  GetServerSettingDuration,
  GetServerSettingNumber,
} from '../../config/server-settings.js';
import { SharpWorkerPool } from '../../workers/sharp.pool.js';
import { SharpWrapper } from '../../workers/sharp.wrapper.js';
import { ConversionLimiterService } from './conversion-limiter.service.js';
import { ImageResult } from './imageresult.js';

interface InternalConvertOptions {
  lossless?: boolean;
  effort?: number;
}

export type ConvertOptions = ImageRequestParams & InternalConvertOptions;

@Injectable()
export class ImageConverterService {
  constructor(
    private readonly limiter: ConversionLimiterService,
    private readonly workers: SharpWorkerPool,
  ) {}

  public async convert(
    image: Buffer,
    sourceFiletype: FileType,
    targetFiletype: FileType,
    options: ConvertOptions,
  ): AsyncFailable<ImageResult> {
    if (
      sourceFiletype.identifier === targetFiletype.identifier &&
      Object.keys(options).length === 0
    ) {
      return {
        filetype: targetFiletype.identifier,
        image,
      };
    }

    if (
      targetFiletype.category === SupportedFileTypeCategory.Image ||
      targetFiletype.category === SupportedFileTypeCategory.Animation
    ) {
      return this.convertImage(image, sourceFiletype, targetFiletype, options);
      //return this.convertAnimation(image, targetmime, options);
    } else {
      return Fail(FT.SysValidation, 'Unsupported mime type');
    }
  }

  // Makes sure an image can be read, by making a tiny version of it
  public async check(image: Buffer, filetype: FileType): AsyncFailable<true> {
    const target = ParseFileType(
      filetype.category === SupportedFileTypeCategory.Animation
        ? AnimFileType.WEBP
        : ImageFileType.WEBP,
    );
    if (HasFailed(target)) return target;

    const result = await this.convertImage(image, filetype, target, {
      width: 16,
    });
    return HasFailed(result) ? result : true;
  }

  // Only a limited amount of conversions run at the same time, each one runs
  // in a worker process and can take a lot of memory
  private async convertImage(
    image: Buffer,
    sourceFiletype: FileType,
    targetFiletype: FileType,
    options: ConvertOptions,
  ): AsyncFailable<ImageResult> {
    const release = await this.limiter.acquire();
    if (HasFailed(release)) return release;
    try {
      return await this.runConversion(
        image,
        sourceFiletype,
        targetFiletype,
        options,
      );
    } finally {
      release();
    }
  }

  private async runConversion(
    image: Buffer,
    sourceFiletype: FileType,
    targetFiletype: FileType,
    options: ConvertOptions,
  ): AsyncFailable<ImageResult> {
    const sharpWrapper = new SharpWrapper(
      this.workers,
      GetServerSettingDuration(ServerSetting.ConversionTimeLimit),
      GetServerSettingNumber(ServerSetting.ConversionMemoryLimit),
    );
    const sharpOptions: SharpOptions = {
      animated: targetFiletype.category === SupportedFileTypeCategory.Animation,
    };
    const hasStarted = await sharpWrapper.start(
      image,
      sourceFiletype,
      sharpOptions,
    );
    if (HasFailed(hasStarted)) return hasStarted;

    // Do modifications
    if (options.height || options.width) {
      if (options.height && options.width) {
        sharpWrapper.operation('resize', {
          width: options.width,
          height: options.height,
          fit: 'fill',
          kernel: 'cubic',
          withoutEnlargement: options.shrinkonly,
        });
      } else {
        sharpWrapper.operation('resize', {
          width: options.width,
          height: options.height,
          fit: 'inside',
          kernel: 'cubic',

          withoutEnlargement: options.shrinkonly,
        });
      }
    }
    if (options.rotate) {
      sharpWrapper.operation('rotate', options.rotate, {
        background: 'transparent',
      });
    }
    if (options.flipx) {
      sharpWrapper.operation('flop');
    }
    if (options.flipy) {
      sharpWrapper.operation('flip');
    }
    if (options.noalpha) {
      sharpWrapper.operation('removeAlpha');
    }
    if (options.negative) {
      sharpWrapper.operation('negate');
    }
    if (options.greyscale) {
      sharpWrapper.operation('greyscale');
    }

    // Export
    const result = await sharpWrapper.finish(targetFiletype, options);
    if (HasFailed(result)) return result;

    return {
      image: result.data,
      filetype: targetFiletype.identifier,
    };
  }
}
