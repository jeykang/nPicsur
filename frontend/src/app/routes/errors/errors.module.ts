import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { E401Component } from './401.component';
import { E404Component } from './404.component';
import { ErrorsRoutingModule } from './errors.routing.module';

@NgModule({
  imports: [CommonModule, ErrorsRoutingModule, E404Component, E401Component],
})
export default class ErrorsRouteModule {}
