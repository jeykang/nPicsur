import { enableProdMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { AppConfig } from './app/app.config';
import Environment from './environments/environment';

if (Environment.production) {
  enableProdMode();
}

bootstrapApplication(AppComponent, AppConfig).catch(console.error);
