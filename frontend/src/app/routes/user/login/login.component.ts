import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AutoUnsubscribe } from 'ngx-auto-unsubscribe-decorator';
import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { LoginControl } from '../../../models/forms/login.control';
import { InfoService } from '../../../services/api/info.service';
import { PermissionService } from '../../../services/api/permission.service';
import { UserPassModel } from '../../../models/forms-dto/userpass.dto';
import { UserService } from '../../../services/api/user.service';
import { Logger } from '../../../services/logger/logger.service';
import { ErrorService } from '../../../util/error-manager/error.service';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel, MatError } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { UpperCasePipe } from '@angular/common';

@Component({
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    MatButton,
    MatFormField,
    MatLabel,
    MatInput,
    MatError,
    UpperCasePipe,
  ],
})
export class LoginComponent implements OnInit {
  private readonly logger = new Logger(LoginComponent.name);

  public showRegister = false;
  public loading = false;
  // How users can log in, as the server says
  public passwordLogin = true;
  public oidcName: string | null = null;
  private canRegister = false;
  // Whether the login page went to the provider right away already
  private launched = false;

  public readonly model = new LoginControl();

  constructor(
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly errorService: ErrorService,
    private readonly infoService: InfoService,
  ) {}

  ngOnInit(): void {
    const state = history.state as UserPassModel;
    if (state) {
      this.model.putData(state);
      history.replaceState(null, '');
    }

    this.onPermissions();
    this.onInfo();
  }

  @AutoUnsubscribe()
  onPermissions() {
    return this.permissionService.live.subscribe((permissions) => {
      this.canRegister = permissions.includes(Permission.UserRegister);
      this.showRegister = this.canRegister && this.passwordLogin;
    });
  }

  @AutoUnsubscribe()
  onInfo() {
    return this.infoService.live.subscribe((info) => {
      this.passwordLogin = info.login?.password ?? true;
      this.oidcName = info.login?.oidc?.name ?? null;
      this.showRegister = this.canRegister && this.passwordLogin;

      // Straight to the provider, unless the login page is asked for with
      // ?local, to log in with a password anyway
      const local = this.route.snapshot.queryParamMap.has('local');
      if (info.login?.oidc?.auto_launch && !local && !this.launched) {
        this.launched = true;
        this.loginWithOidc().catch(this.logger.error);
      }
    });
  }

  async loginWithOidc() {
    this.loading = true;
    const url = await this.userService.startOidcLogin();
    if (HasFailed(url)) {
      this.loading = false;
      return this.errorService.showFailure(url, this.logger);
    }
    window.location.assign(url);
  }

  async onSubmit() {
    const data = this.model.getData();
    if (HasFailed(data)) {
      return;
    }

    this.loading = true;
    const user = await this.userService.login(data.username, data.password);
    this.loading = false;

    if (HasFailed(user))
      return this.errorService.showFailure(user, this.logger);

    this.errorService.success('Logged in');
    this.router.navigate(['/']);
  }

  async onRegister() {
    this.router.navigate(['/user/register'], {
      state: this.model.getRawData(),
    });
  }
}
