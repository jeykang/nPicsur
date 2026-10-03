import { PortalModule } from '@angular/cdk/portal';
import { NgModule } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatSidenavModule } from '@angular/material/sidenav';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app.routing.module';
import { FooterComponent } from './components/footer/footer.component';
import { HeaderModule } from './components/header/header.module';
import { GuardsModule } from './guards/guards.module';
import { SnackBarManagerModule } from './util/snackbar-manager/snackbar-manager.module';

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    PortalModule,
    MatSidenavModule,
    MatButtonModule,
    SnackBarManagerModule.forRoot(),
    GuardsModule,
    AppRoutingModule,
    HeaderModule,
    FooterComponent,
  ],
  providers: [
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline', color: 'accent' },
    },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
