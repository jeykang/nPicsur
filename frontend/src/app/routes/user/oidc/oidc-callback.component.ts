import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { InfoService } from '../../../services/api/info.service';
import { UserService } from '../../../services/api/user.service';
import { Logger } from '../../../services/logger/logger.service';
import { ErrorService } from '../../../util/error-manager/error.service';

// Where the OpenID Connect provider sends the browser back to, after logging
// in there. Finishes logging in here, or linking the account there to the
// account here.
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
    private readonly infoService: InfoService,
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
      const provider = this.infoService.snapshot.login?.oidc?.name;
      this.errorService.success(
        `Your ${provider ?? 'provider'} account is linked, you can log in with it`,
      );
      this.router.navigate(['/settings/account']);
    } else {
      this.errorService.success('Logged in');
      this.router.navigate(['/']);
    }
  }
}
