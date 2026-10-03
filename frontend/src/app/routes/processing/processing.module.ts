import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProcessingComponent } from './processing.component';
import { ProcessingRoutingModule } from './processing.routing.module';
import { ErrorManagerModule } from '../../util/error-manager/error-manager.module';

@NgModule({
  imports: [
    CommonModule,
    ErrorManagerModule,
    ProcessingRoutingModule,
    MatProgressSpinnerModule,
    ProcessingComponent,
  ],
})
export default class ProcessingRouteModule {}
