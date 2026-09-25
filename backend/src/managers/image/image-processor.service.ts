import { Injectable } from '@nestjs/common';
import {
  AnimFileType,
  FileType,
  ImageFileType,
  SupportedFileTypeCategory,
} from 'picsur-shared/dist/dto/mimes.dto';

import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { ParseFileType } from 'picsur-shared/dist/util/parse-mime';
import { ImageConverterService } from './image-converter.service.js';
import { ImageResult } from './imageresult.js';
import { SanitizeImage } from './sanitize.js';

@Injectable()
export class ImageProcessorService {
  constructor(private readonly imageConverter: ImageConverterService) {}

  // Makes the master of an upload, which every other version is made from
  public async process(
    image: Buffer,
    filetype: FileType,
  ): AsyncFailable<ImageResult> {
    // Kept as it is, without its metadata, when possible
    const sanitized = SanitizeImage(image, filetype.identifier);
    if (sanitized !== null) {
      // Uploads that can not be read are refused, like when converting them
      const readable = await this.imageConverter.check(sanitized, filetype);
      if (HasFailed(readable)) return readable;
      return { image: sanitized, filetype: filetype.identifier };
    }

    if (filetype.category === SupportedFileTypeCategory.Image) {
      return await this.processStill(image, filetype);
    } else if (filetype.category === SupportedFileTypeCategory.Animation) {
      return await this.processAnimation(image, filetype);
    } else {
      return Fail(FT.SysValidation, 'Unsupported mime type');
    }
  }

  private async processStill(
    image: Buffer,
    filetype: FileType,
  ): AsyncFailable<ImageResult> {
    const outputFileType = ParseFileType(ImageFileType.QOI);
    if (HasFailed(outputFileType)) return outputFileType;

    return this.imageConverter.convert(image, filetype, outputFileType, {});
  }

  private async processAnimation(
    image: Buffer,
    filetype: FileType,
  ): AsyncFailable<ImageResult> {
    const outputFileType = ParseFileType(AnimFileType.WEBP);
    if (HasFailed(outputFileType)) return outputFileType;

    return this.imageConverter.convert(image, filetype, outputFileType, {
      lossless: true,
      effort: 0,
    });
  }
}
