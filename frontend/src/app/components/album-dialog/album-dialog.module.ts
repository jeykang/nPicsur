import { A11yModule } from '@angular/cdk/a11y';
import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ErrorManagerModule } from '../../util/error-manager/error-manager.module';
import { AddToAlbumDialogComponent } from './add-to-album-dialog.component';
import { AlbumNameDialogComponent } from './album-name-dialog.component';

@NgModule({
  declarations: [AddToAlbumDialogComponent, AlbumNameDialogComponent],
  imports: [
    A11yModule,
    CommonModule,
    ErrorManagerModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  exports: [AddToAlbumDialogComponent, AlbumNameDialogComponent],
})
export class AlbumDialogModule {}
