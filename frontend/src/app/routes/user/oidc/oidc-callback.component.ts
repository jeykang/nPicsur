import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { UserService } from '../../../services/api/user.service';
import { Logger } from '../../../services/logger/logger.service';
import { ErrorService } from '../../../util/error-manager/error.service';

// Where the OpenID Connect provider sends the browser back to, after logging
// in there. Finishes logging in here, or linking the login to the account.
@Component({
  templateUrl: './oidc-callback.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class OidcCallbackComponent implements OnInit {
  private readonly logger = new Logger(OidcCallbackComponent.name);

  public error: string | null = null;

  constructor(
    private readonly userService: UserService,
    private readonly router: Router,
    private readonly errorService: ErrorService,
  ) {}

  async ngOnInit() {
    // The code from the provider does not belong in the history
    const url = window.location.href;
    history.replaceState(null, '', window.location.pathname);

    const result = await this.userService.finishOidc(url);
    if (HasFailed(result)) {
      this.error = result.getReason();
      return this.errorService.showFailure(result, this.logger);
    }

    if (result.linked) {
      this.errorService.success('Your login is linked to this account');
      this.router.navigate(['/settings/account']);
    } else {
      this.errorService.success('Login successful');
      this.router.navigate(['/']);
    }
  }
}
