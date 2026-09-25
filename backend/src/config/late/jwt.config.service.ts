import { FactoryProvider, Injectable, Logger } from '@nestjs/common';
import { JwtModuleOptions, JwtOptionsFactory } from '@nestjs/jwt';
import ms from 'ms';
import { ThrowIfFailed } from 'picsur-shared/dist/types/failable';
import { SysPreferenceDbService } from '../../collections/preference-db/sys-preference-db.service.js';
import { EarlyJwtConfigService } from '../early/early-jwt.config.service.js';

export const JwtAlgorithm = 'HS256';

@Injectable()
export class JwtConfigService implements JwtOptionsFactory {
  private readonly logger = new Logger(JwtConfigService.name);

  constructor(
    private readonly prefService: SysPreferenceDbService,
    private readonly envJwtConfig: EarlyJwtConfigService,
  ) {
    this.printDebug().catch(this.logger.error);
  }

  private async printDebug() {
    const expiresIn = await this.getJwtExpiresIn();
    this.logger.verbose('JWT expiresIn: ' + expiresIn);
  }

  public async getJwtSecret(): Promise<string> {
    // The environment always wins, it is copied into the database as well,
    // but that happens after this is first read during startup. Reading it
    // here directly makes a rotated secret take effect on the first restart.
    const envSecret = this.envJwtConfig.getJwtSecret();
    if (envSecret !== undefined) return envSecret;

    const secret = ThrowIfFailed(
      await this.prefService.getStringPreference('jwt_secret'),
    );

    return secret;
  }

  public async getJwtExpiresIn(): Promise<number> {
    const expiresIn =
      this.envJwtConfig.getJwtExpiresIn() ??
      ThrowIfFailed(
        await this.prefService.getStringPreference('jwt_expires_in'),
      );

    let milliseconds = ms(expiresIn as string);
    if (isNaN(milliseconds)) {
      milliseconds = 1000 * 60 * 60 * 24; // 1 day
    }

    return milliseconds / 1000;
  }

  public async createJwtOptions(): Promise<JwtModuleOptions> {
    return {
      secret: await this.getJwtSecret(),
      signOptions: {
        algorithm: JwtAlgorithm,
        expiresIn: await this.getJwtExpiresIn(),
      },
      verifyOptions: {
        algorithms: [JwtAlgorithm],
      },
    };
  }
}

export const JwtSecretProvider: FactoryProvider<Promise<string>> = {
  provide: 'JWT_SECRET',
  useFactory: async (jwtConfigService: JwtConfigService) => {
    return await jwtConfigService.getJwtSecret();
  },
  inject: [JwtConfigService],
};
