import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { UserLoginMethodsResponse } from 'picsur-shared/dist/dto/api/user.dto';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { ChangePasswordControl } from '../../../models/forms/change-password.control';
import { InfoService } from '../../../services/api/info.service';
import { UserService } from '../../../services/api/user.service';
import { Logger } from '../../../services/logger/logger.service';
import { ErrorService } from '../../../util/error-manager/error.service';

@Component({
  templateUrl: './settings-account.component.html',
  styleUrls: ['./settings-account.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsAccountComponent implements OnInit {
  private readonly logger = new Logger(SettingsAccountComponent.name);

  public readonly model = new ChangePasswordControl();
  public loading = false;
  // How the user can log in, null until it is known
  public methods: UserLoginMethodsResponse | null = null;

  public get hasPassword(): boolean {
    return this.methods?.password ?? true;
  }

  // Whether this server lets anyone log in with a password
  public get passwordLogin(): boolean {
    return this.infoService.snapshot.login?.password ?? true;
  }

  constructor(
    public readonly userService: UserService,
    private readonly infoService: InfoService,
    private readonly errorService: ErrorService,
  ) {}

  async ngOnInit() {
    const methods = await this.userService.getLoginMethods();
    if (HasFailed(methods)) {
      return this.errorService.showFailure(methods, this.logger);
    }
    this.methods = methods;
  }

  async linkOidc() {
    this.loading = true;
    const url = await this.userService.startOidcLink();
    if (HasFailed(url)) {
      this.loading = false;
      return this.errorService.showFailure(url, this.logger);
    }
    window.location.assign(url);
  }

  async unlinkOidc() {
    this.loading = true;
    const methods = await this.userService.unlinkOidc();
    this.loading = false;
    if (HasFailed(methods)) {
      return this.errorService.showFailure(methods, this.logger);
    }
    this.methods = methods;
    this.errorService.success('Your login is no longer linked');
  }

  async changePassword() {
    const hadPassword = this.hasPassword;
    const data = this.model.getData(hadPassword);
    if (HasFailed(data)) return;

    this.loading = true;
    const result = await this.userService.changePassword(
      data.current,
      data.new,
    );
    this.loading = false;
    if (HasFailed(result)) {
      return this.errorService.showFailure(result, this.logger);
    }

    this.model.reset();
    if (this.methods !== null)
      this.methods = { ...this.methods, password: true };
    this.errorService.success(
      hadPassword
        ? 'Password changed, you were logged out everywhere else'
        : this.passwordLogin
          ? 'Password set, you can log in with it now'
          : 'Password set',
    );
  }
}
