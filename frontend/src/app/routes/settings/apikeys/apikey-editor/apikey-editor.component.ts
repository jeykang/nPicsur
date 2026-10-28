import {
  Component,
  EventEmitter,
  Input,
  Output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormControl, Validators, ReactiveFormsModule } from '@angular/forms';
import { Logger } from '../../../../services/logger/logger.service';
import { MatFormField, MatLabel, MatError } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';

@Component({
  selector: 'app-settings-apikey-editor',
  templateUrl: './apikey-editor.component.html',
  styleUrls: ['./apikey-editor.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [MatFormField, MatLabel, MatInput, ReactiveFormsModule, MatError],
})
export class SettingsApiKeyEditorComponent {
  private readonly logger = new Logger(SettingsApiKeyEditorComponent.name);

  @Input() set value(value: string) {
    this.field.setValue(value);
  }

  @Output('changed') change = new EventEmitter<string>();

  field = new FormControl('', [
    Validators.required,
    Validators.minLength(3),
    Validators.maxLength(255),
  ]);

  async update() {
    if (this.field.invalid) {
      return;
    }

    const value = this.field.value;
    if (value === null) return;

    this.change.emit(value);
  }

  getErrorMessage() {
    if (this.field.hasError('required')) {
      return 'Enter a name';
    }

    if (this.field.hasError('minlength')) {
      return 'Use at least 3 characters';
    }

    if (this.field.hasError('maxlength')) {
      return 'Use no more than 255 characters';
    }

    return 'Unknown error';
  }
}
