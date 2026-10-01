import { FactoryProvider, Injectable, Logger } from '@nestjs/common';
import { JwtModuleOptions, JwtOptionsFactory } from '@nestjs/jwt';
import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { ThrowIfFailed } from 'picsur-shared/dist/types/failable';
import { generateRandomString } from 'picsur-shared/dist/util/random';
import { SystemStateDbService } from '../../collections/system-state-db/system-state-db.service.js';
import { EarlyJwtConfigService } from '../early/early-jwt.config.service.js';
import { GetServerSettingDuration } from '../server-settings.js';

export const JwtAlgorithm = 'HS256';
// Where the generated secret is kept
export const JwtSecretState = 'jwt_secret';

@Injectable()
export class JwtConfigService implements JwtOptionsFactory {
  private readonly logger = new Logger(JwtConfigService.name);
  private secret: Promise<string> | undefined;

  constructor(
    private readonly stateDb: SystemStateDbService,
    private readonly envJwtConfig: EarlyJwtConfigService,
  ) {}

  // Logins are signed with this, whoever knows it can log in as anyone.
  // PICSUR_JWT_SECRET, or otherwise a secret generated and kept in the
  // database.
  public getJwtSecret(): Promise<string> {
    this.secret ??= this.loadJwtSecret();
    return this.secret;
  }

  // In seconds, read when a login is made, so changes apply to new logins
  public getJwtExpiresIn(): number {
    return GetServerSettingDuration(ServerSetting.JwtExpiry) / 1000;
  }

  public async createJwtOptions(): Promise<JwtModuleOptions> {
    return {
      secret: await this.getJwtSecret(),
      signOptions: {
        algorithm: JwtAlgorithm,
      },
      verifyOptions: {
        algorithms: [JwtAlgorithm],
      },
    };
  }

  private async loadJwtSecret(): Promise<string> {
    const envSecret = this.envJwtConfig.getJwtSecret();
    if (envSecret !== undefined) {
      if (envSecret.length < 32) {
        this.logger.warn(
          'PICSUR_JWT_SECRET is shorter than 32 characters, which makes it easier to guess, and whoever knows it can log in as anyone. Use a long random value, or leave it out to have one generated.',
        );
      }
      return envSecret;
    }

    let secret = ThrowIfFailed(await this.stateDb.get(JwtSecretState));
    if (secret === null) {
      // Fails when another instance created one at the same time
      await this.stateDb.set(JwtSecretState, generateRandomString(64));
      secret = ThrowIfFailed(await this.stateDb.get(JwtSecretState));
      if (secret === null) {
        throw new Error('Could not keep a secret to sign logins with');
      }
      this.logger.log(
        'Generated a secret to sign logins with, it is kept in the database',
      );
    }
    return secret;
  }
}

export const JwtSecretProvider: FactoryProvider<Promise<string>> = {
  provide: 'JWT_SECRET',
  useFactory: async (jwtConfigService: JwtConfigService) => {
    return await jwtConfigService.getJwtSecret();
  },
  inject: [JwtConfigService],
};
