import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterModule } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { OidcCallbackComponent } from './oidc/oidc-callback.component';
import { RegisterComponent } from './register/register.component';
import { UserRoutingModule } from './user.routing.module';
import { ErrorManagerModule } from '../../util/error-manager/error-manager.module';

@NgModule({
  declarations: [LoginComponent, RegisterComponent, OidcCallbackComponent],
  imports: [
    CommonModule,
    ErrorManagerModule,

    UserRoutingModule,
    RouterModule,
    FormsModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    ReactiveFormsModule,
  ],
})
export default class UserRouteModule {}
