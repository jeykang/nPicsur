import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { DeleteComponent } from './delete.component';
import { DeleteRoutingModule } from './delete.routing.module';

@NgModule({
  declarations: [DeleteComponent],
  imports: [CommonModule, DeleteRoutingModule, MatButtonModule],
})
export default class DeleteRouteModule {}
