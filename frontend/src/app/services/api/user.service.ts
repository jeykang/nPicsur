import { Injectable } from '@angular/core';
import {
  UserChangePasswordRequest,
  UserChangePasswordResponse,
  UserCheckNameRequest,
  UserCheckNameResponse,
  UserLoginMethodsResponse,
  UserLoginRequest,
  UserLoginResponse,
  UserMeResponse,
  UserOidcCallbackRequest,
  UserOidcCallbackResponse,
  UserOidcStartResponse,
  UserRegisterRequest,
  UserRegisterResponse,
} from 'picsur-shared/dist/dto/api/user.dto';
import { EUser } from 'picsur-shared/dist/entities/user.entity';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
  Open,
} from 'picsur-shared/dist/types/failable';
import { BehaviorSubject } from 'rxjs';
import { Logger } from '../logger/logger.service';
import { KeyStorageService } from '../storage/key-storage.service';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private userSubject = new BehaviorSubject<EUser | null>(null);

  public get live() {
    return this.userSubject.asObservable();
  }

  public get snapshot() {
    return this.userSubject.getValue();
  }

  public get isLoggedIn() {
    return this.userSubject.getValue() !== null;
  }

  constructor(
    private readonly api: ApiService,
    private readonly key: KeyStorageService,
  ) {
    this.init().catch(this.logger.error);
  }

  private async init(retryDelay = 1000) {
    const apikey = await this.key.get();
    if (!apikey) return;

    const fetchedUser = await this.fetchUser();
    if (HasFailed(fetchedUser)) {
      this.logger.error(fetchedUser.getReason());
      if (fetchedUser.getType() === FT.Permission) {
        // The login is no longer valid
        await this.logout();
      } else {
        // The server could not be reached, keep the login and try again
        window.setTimeout(
          () =>
            this.init(Math.min(retryDelay * 2, 30000)).catch(this.logger.error),
          retryDelay,
        );
      }
      return;
    }

    this.userSubject.next(fetchedUser);
  }

  public async login(username: string, password: string): AsyncFailable<EUser> {
    const response = await this.api.post(
      UserLoginRequest,
      UserLoginResponse,
      '/api/user/login',
      {
        username,
        password,
      },
    ).result;
    if (HasFailed(response)) return response;

    // Set the key so the apiservice can use it
    this.key.set(response.jwt_token);

    const user = await this.fetchUser();
    if (HasFailed(user)) return user;

    this.userSubject.next(user);
    return user;
  }

  public async checkNameIsAvailable(username: string): AsyncFailable<boolean> {
    return Open(
      await this.api.post(
        UserCheckNameRequest,
        UserCheckNameResponse,
        '/api/user/checkname',
        {
          username,
        },
      ).result,
      'available',
    );
  }

  public async register(
    username: string,
    password: string,
  ): AsyncFailable<EUser> {
    return await this.api.post(
      UserRegisterRequest,
      UserRegisterResponse,
      '/api/user/register',
      {
        username,
        password,
      },
    ).result;
  }

  // Users without a password set one without a current one
  public async changePassword(
    currentPassword: string | null,
    newPassword: string,
  ): AsyncFailable<true> {
    const response = await this.api.post(
      UserChangePasswordRequest,
      UserChangePasswordResponse,
      '/api/user/me/password',
      {
        current_password: currentPassword ?? undefined,
        new_password: newPassword,
      },
    ).result;
    if (HasFailed(response)) return response;

    // The old token no longer works
    this.key.set(response.jwt_token);
    return true;
  }

  // Where to send the browser to log in with the OpenID Connect provider
  public async startOidcLogin(): AsyncFailable<string> {
    return Open(
      await this.api.postEmpty(UserOidcStartResponse, '/api/user/oidc/login')
        .result,
      'url',
    );
  }

  // Where to send the browser to link a login at the provider to the account
  public async startOidcLink(): AsyncFailable<string> {
    return Open(
      await this.api.postEmpty(UserOidcStartResponse, '/api/user/me/oidc')
        .result,
      'url',
    );
  }

  // Finishes logging in, or linking a login, with the url the provider sent
  // the browser back to
  public async finishOidc(url: string): AsyncFailable<{ linked: boolean }> {
    const response = await this.api.post(
      UserOidcCallbackRequest,
      UserOidcCallbackResponse,
      '/api/user/oidc/callback',
      { url },
    ).result;
    if (HasFailed(response)) return response;
    if (response.jwt_token === null) return { linked: true };

    this.key.set(response.jwt_token);
    const user = await this.fetchUser();
    if (HasFailed(user)) return user;
    this.userSubject.next(user);
    return { linked: false };
  }

  public async getLoginMethods(): AsyncFailable<UserLoginMethodsResponse> {
    return await this.api.get(UserLoginMethodsResponse, '/api/user/me/login')
      .result;
  }

  public async unlinkOidc(): AsyncFailable<UserLoginMethodsResponse> {
    return await this.api.delete(UserLoginMethodsResponse, '/api/user/me/oidc')
      .result;
  }

  public async logout(): AsyncFailable<EUser> {
    const value = this.snapshot;

    this.key.clear();
    this.userSubject.next(null);

    if (value === null) {
      return Fail(FT.Impossible, 'Not logged in');
    } else {
      return value;
    }
  }

  // This actually fetches up to date information from the server
  private async fetchUser(): AsyncFailable<EUser> {
    const got = await this.api.get(UserMeResponse, '/api/user/me').result;
    if (HasFailed(got)) return got;

    this.key.set(got.token);
    return got.user;
  }
}
