import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { ChangePasswordControl } from '../../../models/forms/change-password.control';
import { UserService } from '../../../services/api/user.service';
import { Logger } from '../../../services/logger/logger.service';
import { ErrorService } from '../../../util/error-manager/error.service';

@Component({
  templateUrl: './settings-account.component.html',
  styleUrls: ['./settings-account.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsAccountComponent {
  private readonly logger = new Logger(SettingsAccountComponent.name);

  public readonly model = new ChangePasswordControl();
  public loading = false;

  constructor(
    public readonly userService: UserService,
    private readonly errorService: ErrorService,
  ) {}

  async changePassword() {
    const data = this.model.getData();
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
    this.errorService.success(
      'Password changed, you were logged out everywhere else',
    );
  }
}
