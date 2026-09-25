import { FormControl } from '@angular/forms';
import { Fail, Failable, FT } from 'picsur-shared/dist/types/failable';
import { Compare } from '../validators/compare.validator';
import {
  CreatePasswordError,
  PasswordValidators,
} from '../validators/user.validator';

export class ChangePasswordControl {
  public currentPassword = new FormControl('', PasswordValidators);
  public newPassword = new FormControl('', PasswordValidators);
  public newPasswordConfirm = new FormControl('', [
    ...PasswordValidators,
    Compare(this.newPassword),
  ]);

  public get currentPasswordError() {
    return CreatePasswordError(this.currentPassword.errors);
  }

  public get newPasswordError() {
    return CreatePasswordError(this.newPassword.errors);
  }

  public get newPasswordConfirmError() {
    return CreatePasswordError(this.newPasswordConfirm.errors);
  }

  public getData(): Failable<{ current: string; new: string }> {
    if (
      this.currentPassword.errors ||
      this.newPassword.errors ||
      this.newPasswordConfirm.errors
    )
      return Fail(FT.UsrValidation, 'Invalid password');

    return {
      current: this.currentPassword.value ?? '',
      new: this.newPassword.value ?? '',
    };
  }

  public reset() {
    this.currentPassword.reset('');
    this.newPassword.reset('');
    this.newPasswordConfirm.reset('');
  }
}
