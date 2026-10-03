import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { EarlyConfigModule } from '../../../config/early/early-config.module.js';
import { OpenApiController } from './openapi.controller.js';
import { OpenApiService } from './openapi.service.js';

@Module({
  imports: [DiscoveryModule, EarlyConfigModule],
  providers: [OpenApiService],
  controllers: [OpenApiController],
})
export class OpenApiModule {}
