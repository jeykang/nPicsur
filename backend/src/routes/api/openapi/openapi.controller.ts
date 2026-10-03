import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { NoPermissions } from '../../../decorators/permissions.decorator.js';
import { OpenApiService } from './openapi.service.js';

@Controller('api')
@NoPermissions()
export class OpenApiController {
  constructor(private readonly openApi: OpenApiService) {}

  // The OpenAPI document of the api, as it is, for tools that read it
  @Get('openapi.json')
  getDocument(@Res({ passthrough: true }) res: FastifyReply): Buffer {
    res.type('application/json');
    return this.openApi.getDocument();
  }
}
