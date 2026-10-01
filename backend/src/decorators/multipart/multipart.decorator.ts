import { InjectRequest } from './inject-request.decorator.js';
import { MultiPartPipe } from './multipart.pipe.js';

export const PostFiles = (maxFiles?: number) =>
  InjectRequest(maxFiles, MultiPartPipe);
