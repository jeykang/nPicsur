import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MAT_SNACK_BAR_DEFAULT_OPTIONS } from '@angular/material/snack-bar';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { AppRoutes } from './app.routes';

export const AppConfig: ApplicationConfig = {
  providers: [
    // The components rely on zone.js to know when to check for changes, and
    // without this Angular does not use it
    provideZoneChangeDetection(),
    provideRouter(AppRoutes),
    provideAnimations(),
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline', color: 'accent' },
    },
    {
      provide: MAT_SNACK_BAR_DEFAULT_OPTIONS,
      useValue: { duration: 4000, horizontalPosition: 'left' },
    },
  ],
};
