import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AsyncFailable, Fail, FT } from 'picsur-shared/dist/types/failable';
import { Repository } from 'typeorm';
import { EUserOidcBackend } from '../../database/entities/users/user-oidc.entity.js';

// Postgres' error code for a duplicate value in a unique column
const UniqueViolation = '23505';

// Logins at an OpenID Connect provider, and the users they are linked to
@Injectable()
export class UserOidcDbService {
  constructor(
    @InjectRepository(EUserOidcBackend)
    private readonly repository: Repository<EUserOidcBackend>,
  ) {}

  // The link of the login with this subject at the provider, if there is one
  public async findByLogin(
    issuer: string,
    subject: string,
  ): AsyncFailable<EUserOidcBackend | null> {
    try {
      return await this.repository.findOne({ where: { issuer, subject } });
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  // The login at the provider the user is linked to, if any
  public async findForUser(
    userId: string,
    issuer: string,
  ): AsyncFailable<EUserOidcBackend | null> {
    try {
      return await this.repository.findOne({
        where: { user_id: userId, issuer },
      });
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async link(
    userId: string,
    issuer: string,
    subject: string,
    name: string | null,
  ): AsyncFailable<EUserOidcBackend> {
    const link = new EUserOidcBackend();
    link.user_id = userId;
    link.issuer = issuer;
    link.subject = subject;
    link.name = name;
    link.created = new Date();
    link.last_login = null;

    try {
      return await this.repository.save(link);
    } catch (e: any) {
      if (e?.code === UniqueViolation) {
        return Fail(
          FT.Conflict,
          'This login is linked to an account already, or this account to another login',
        );
      }
      return Fail(FT.Database, e);
    }
  }

  // Remembers when the login was last used, and what the provider called the
  // user then
  public async loggedIn(id: string, name: string | null): AsyncFailable<true> {
    try {
      await this.repository.update({ id }, { last_login: new Date(), name });
      return true;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  // Whether there was a link to remove
  public async unlink(userId: string, issuer: string): AsyncFailable<boolean> {
    try {
      const result = await this.repository.delete({ user_id: userId, issuer });
      return (result.affected ?? 0) > 0;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }
}
