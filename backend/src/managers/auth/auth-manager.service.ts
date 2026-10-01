import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtData, JwtDataSchema } from 'picsur-shared/dist/dto/jwt.dto';
import { EUser } from 'picsur-shared/dist/entities/user.entity';
import { AsyncFailable, Fail, FT } from 'picsur-shared/dist/types/failable';
import { JwtConfigService } from '../../config/late/jwt.config.service.js';

@Injectable()
export class AuthManagerService {
  private readonly logger = new Logger(AuthManagerService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly jwtConfig: JwtConfigService,
  ) {}

  async createToken(user: EUser): AsyncFailable<string> {
    const jwtData: JwtData = {
      uid: user.id,
    };

    // Validate to be sure, this makes client experience better
    // in case of any failures
    const result = JwtDataSchema.safeParse(jwtData);
    if (!result.success) {
      return Fail(FT.SysValidation, undefined, 'Invalid JWT: ' + result.error);
    }

    try {
      return await this.jwtService.signAsync(result.data, {
        expiresIn: this.jwtConfig.getJwtExpiresIn(),
      });
    } catch (e) {
      return Fail(FT.Internal, undefined, "Couldn't create JWT: " + e);
    }
  }
}
