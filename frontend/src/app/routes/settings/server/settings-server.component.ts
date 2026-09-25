import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { AbstractControl, FormControl, FormGroup } from '@angular/forms';
import {
  ServerSettingState,
  ServerSettingsResponse,
  StorageStatusResponse,
} from 'picsur-shared/dist/dto/api/server.dto';
import {
  SecretServerSettings,
  ServerSetting,
  ServerSettingList,
  ServerSettingValidators,
  StorageSettings,
} from 'picsur-shared/dist/dto/server-settings.dto';
import { Failure, HasFailed } from 'picsur-shared/dist/types/failable';
import { ServerSettingUI } from '../../../i18n/server-settings.i18n';
import { ServerSettingsService } from '../../../services/api/server-settings.service';
import { Logger } from '../../../services/logger/logger.service';
import { DialogService } from '../../../util/dialog-manager/dialog.service';
import { ErrorService } from '../../../util/error-manager/error.service';

type SettingControls = { [key in ServerSetting]: FormControl<string> };
type StorageDriver = 'database' | 's3' | 'filesystem';
const StorageDrivers: StorageDriver[] = ['database', 's3', 'filesystem'];

// The maximum upload size is shown in MB instead of bytes
const BYTES_PER_MB = 1000 * 1000;

function bytesToMb(bytes: string): string {
  const value = Number(bytes);
  if (!Number.isFinite(value)) return bytes;
  return String(Math.round((value / BYTES_PER_MB) * 1e6) / 1e6);
}

function mbToBytes(mb: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(mb)) return null;
  return String(Math.round(Number(mb) * BYTES_PER_MB));
}

export function StorageName(driver: StorageDriver | null): string {
  switch (driver) {
    case 's3':
      return 'the bucket';
    case 'filesystem':
      return 'the directory';
    default:
      return 'the database';
  }
}

function AsDriver(value: string | null | undefined): StorageDriver {
  return StorageDrivers.find((driver) => driver === value) ?? 'database';
}

@Component({
  templateUrl: './settings-server.component.html',
  styleUrls: ['./settings-server.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsServerComponent implements OnInit, OnDestroy {
  private readonly logger = new Logger(SettingsServerComponent.name);

  public readonly S = ServerSetting;
  public readonly storageName = StorageName;

  public settings: ServerSettingsResponse | null = null;
  public storage: StorageStatusResponse | null = null;
  public loadFailure: Failure | null = null;

  public readonly form: FormGroup<SettingControls>;
  // What the form showed when the settings were loaded
  private initial: Partial<Record<ServerSetting, string>> = {};
  // Whether the stored secret access key is removed on saving
  public removeSecret = false;
  // Why the directory that was tested might not be safe for images
  public pathWarning: string | null = null;

  public busy: 'saving' | 'testing' | 'restarting' | 'migrating' | null = null;
  public testing: 's3' | 'filesystem' | null = null;
  private migrationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly serverSettings: ServerSettingsService,
    private readonly dialogService: DialogService,
    private readonly errorService: ErrorService,
  ) {
    const controls = {} as SettingControls;
    for (const key of ServerSettingList) {
      controls[key] = new FormControl('', {
        nonNullable: true,
        validators: (control) => this.validate(key, control),
      });
    }
    this.form = new FormGroup(controls);
  }

  async ngOnInit() {
    await this.load();
  }

  ngOnDestroy() {
    this.stopPolling();
  }

  async load() {
    const [settings, storage] = await Promise.all([
      this.serverSettings.getSettings(),
      this.serverSettings.getStorage(),
    ]);
    if (HasFailed(settings)) {
      this.loadFailure = settings;
      return;
    }
    if (HasFailed(storage)) {
      this.loadFailure = storage;
      return;
    }
    this.loadFailure = null;
    this.showSettings(settings);
    this.showStorage(storage);
  }

  // Template helpers

  public control(key: ServerSetting): FormControl<string> {
    return this.form.controls[key];
  }

  public name(key: ServerSetting): string {
    return ServerSettingUI[key].name;
  }

  // Settings from the environment say where they come from instead, and
  // secrets how they are protected
  public hint(key: ServerSetting): string {
    if (this.locked(key)) return `Set with ${this.state(key)?.env}`;
    const help = ServerSettingUI[key].helpText;
    if (!SecretServerSettings.includes(key)) return help;

    switch (this.settings?.encryption_key) {
      case 'environment':
        return `${help} It is saved encrypted with PICSUR_ENCRYPTION_KEY, which is not stored in the database.`;
      case 'database':
        return `${help} It is saved encrypted, but with a key kept in the database as well, so a copy of the database reveals it. Setting PICSUR_ENCRYPTION_KEY prevents that, see the README.`;
      default:
        return 'Secrets can not be saved right now, there is no key to encrypt them with. The server log says why.';
    }
  }

  // Environment variables whose values are saved as well, so they can be
  // removed from Picsur's configuration
  public get removableEnv(): string[] {
    return (this.settings?.settings ?? [])
      .filter((s) => s.source === 'environment' && s.saved)
      .map((s) => s.env);
  }

  // Environment variables that have to stay, with why
  public get keptEnv(): { env: string; reason: string }[] {
    return (this.settings?.settings ?? [])
      .filter((s) => s.source === 'environment' && !s.saved)
      .map((s) => ({
        env: s.env,
        reason:
          SecretServerSettings.includes(s.key as ServerSetting) &&
          this.settings?.encryption_key === null
            ? 'there is no key to encrypt secrets with right now'
            : 'this page does not accept its value',
      }));
  }

  public state(key: ServerSetting): ServerSettingState | null {
    return this.settings?.settings.find((s) => s.key === key) ?? null;
  }

  public locked(key: ServerSetting): boolean {
    return this.state(key)?.source === 'environment';
  }

  public placeholder(key: ServerSetting): string {
    const state = this.state(key);
    if (state === null) return '';
    if (SecretServerSettings.includes(key)) {
      return state.source === 'settings' && !this.removeSecret
        ? 'Saved, leave empty to keep it'
        : '';
    }
    if (state.default === null) return '';
    return key === ServerSetting.MaxFileSize
      ? bytesToMb(state.default)
      : state.default;
  }

  public error(key: ServerSetting): string {
    const errors = this.form.controls[key].errors;
    return errors?.['error'] ?? 'Invalid value';
  }

  public get driver(): StorageDriver {
    return AsDriver(this.form.controls[ServerSetting.StorageDriver].value);
  }

  // A bucket that is set is also used to read images stored there before
  public get bucketIsSet(): boolean {
    return this.state(ServerSetting.S3Bucket)?.set ?? false;
  }

  public get showBucket(): boolean {
    return this.driver === 's3' || this.bucketIsSet;
  }

  // Like the bucket, a directory that is set is also used for reading
  public get pathIsSet(): boolean {
    return this.state(ServerSetting.StoragePath)?.set ?? false;
  }

  public get showPath(): boolean {
    return this.driver === 'filesystem' || this.pathIsSet;
  }

  public get secretIsSet(): boolean {
    return this.state(ServerSetting.S3SecretAccessKey)?.set ?? false;
  }

  public get hasChanges(): boolean {
    return Object.keys(this.changes()).length > 0;
  }

  // How many image files are where, of the places that are used
  public get fileCounts(): string {
    const storage = this.storage;
    if (storage === null) return '';

    const count = storage.files.database;
    let text = `There ${count === 1 ? 'is' : 'are'} ${count} image ${count === 1 ? 'file' : 'files'} in the database`;
    const others: string[] = [];
    if (storage.bucket !== null || storage.files.s3 > 0) {
      others.push(`${storage.files.s3} in the bucket`);
    }
    if (storage.path !== null || storage.files.filesystem > 0) {
      others.push(`${storage.files.filesystem} in the directory`);
    }
    if (others.length === 1) text += `, and ${others[0]}`;
    if (others.length === 2) text += `, ${others[0]} and ${others[1]}`;
    return text + '.';
  }

  // Files that are not where new ones go
  public get filesElsewhere(): number {
    if (this.storage === null) return 0;
    return this.filesNotIn(this.storage.driver);
  }

  public get migrationProgress(): number {
    const migration = this.storage?.migration;
    if (!migration || migration.total === 0) return 0;
    return ((migration.moved + migration.failed) / migration.total) * 100;
  }

  public toggleRemoveSecret() {
    this.removeSecret = !this.removeSecret;
    this.form.controls[ServerSetting.S3SecretAccessKey].setValue('');
  }

  // Empties all bucket settings, to be saved
  public removeBucket() {
    for (const key of StorageSettings) {
      if (
        key === ServerSetting.StorageDriver ||
        key === ServerSetting.StoragePath ||
        this.locked(key)
      ) {
        continue;
      }
      const control = this.form.controls[key];
      control.setValue(key === ServerSetting.S3ForcePathStyle ? 'false' : '');
      control.markAsDirty();
    }
    if (this.secretIsSet) this.removeSecret = true;
  }

  // Empties the directory setting, to be saved
  public removePath() {
    const control = this.form.controls[ServerSetting.StoragePath];
    control.setValue('');
    control.markAsDirty();
    this.pathWarning = null;
  }

  // Actions

  async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const changes = this.changes();
    if (Object.keys(changes).length === 0) return;

    this.busy = 'saving';
    const result = await this.serverSettings.updateSettings(changes);
    this.busy = null;
    if (HasFailed(result)) {
      return this.errorService.showFailure(result, this.logger);
    }

    this.showSettings(result);
    if (!result.restart_needed) {
      this.errorService.success('Saved');
      return;
    }
    await this.promptRestart();
  }

  async testStorage(storage: 's3' | 'filesystem') {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.busy = 'testing';
    this.testing = storage;
    const result = await this.serverSettings.testStorage(
      this.changes(StorageSettings),
      storage,
    );
    this.busy = null;
    this.testing = null;
    if (HasFailed(result)) {
      return this.errorService.showFailure(result, this.logger);
    }

    const where =
      result.driver === 's3'
        ? `bucket "${result.location}"`
        : `directory "${result.location}"`;
    if (result.driver === 'filesystem') this.pathWarning = result.warning;
    if (result.warning !== null) {
      this.errorService.warn(
        `Images can be stored in ${where}, but look into the warning`,
        this.logger,
      );
      return;
    }
    this.errorService.success(
      result.created
        ? `Created ${where}, images can be stored there`
        : `Images can be stored in ${where}`,
    );
  }

  async promptRestart() {
    if (this.settings === null || this.storage === null) return;

    // Where new images go once restarted
    const next = AsDriver(this.state(ServerSetting.StorageDriver)?.value);
    const toMove = next === this.storage.driver ? 0 : this.filesNotIn(next);

    let description =
      'Picsur is unavailable for a moment while it restarts, uploads in progress fail.';
    if (toMove > 0) {
      description += ` There ${toMove === 1 ? 'is 1 image file' : `are ${toMove} image files`} stored elsewhere, which can be moved to ${StorageName(next)} after the restart.`;
    }

    const pressed = await this.dialogService.showDialog({
      title: 'Restart Picsur to apply the changes?',
      description,
      buttons: [
        { name: 'later', text: 'Later' },
        {
          name: 'restart',
          text: 'Restart',
          color: toMove > 0 ? undefined : 'primary',
        },
        ...(toMove > 0
          ? [{ name: 'move', text: 'Restart and move', color: 'primary' }]
          : []),
      ],
    });
    if (pressed === 'restart' || pressed === 'move') {
      await this.restart(pressed === 'move');
    }
  }

  async restart(thenMove = false) {
    this.busy = 'restarting';
    const result = await this.serverSettings.restart();
    this.busy = null;
    if (HasFailed(result)) {
      return this.errorService.showFailure(result, this.logger);
    }

    this.showSettings(result);
    const storage = await this.serverSettings.getStorage();
    if (!HasFailed(storage)) this.showStorage(storage);

    if (result.restart_error !== null) {
      this.errorService.warn(
        'Picsur could not start with the new settings, it uses the previous ones',
        this.logger,
      );
      return;
    }
    this.errorService.success('Picsur restarted');
    if (thenMove && this.filesElsewhere > 0) await this.startMigration();
  }

  async startMigration() {
    this.busy = 'migrating';
    const result = await this.serverSettings.startMigration();
    this.busy = null;
    if (HasFailed(result)) {
      return this.errorService.showFailure(result, this.logger);
    }
    this.showStorage(result);
  }

  async stopMigration() {
    const result = await this.serverSettings.stopMigration();
    if (HasFailed(result)) {
      return this.errorService.showFailure(result, this.logger);
    }
    this.showStorage(result);
  }

  // Internals

  private filesNotIn(driver: StorageDriver): number {
    if (this.storage === null) return 0;
    return StorageDrivers.filter((other) => other !== driver).reduce(
      (total, other) => total + this.storage!.files[other],
      0,
    );
  }

  private showSettings(settings: ServerSettingsResponse) {
    this.settings = settings;
    this.removeSecret = false;
    this.pathWarning = null;
    this.initial = {};

    for (const state of settings.settings) {
      const key = state.key as ServerSetting;
      const control = this.form.controls[key];
      if (control === undefined) continue;

      const value = this.formValue(key, state);
      this.initial[key] = value;
      control.setValue(value);
      if (
        state.source === 'environment' ||
        (SecretServerSettings.includes(key) && settings.encryption_key === null)
      ) {
        control.disable();
      } else {
        control.enable();
      }
    }
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  private showStorage(storage: StorageStatusResponse) {
    const wasRunning = this.storage?.migration.running ?? false;
    this.storage = storage;

    if (storage.migration.running) {
      this.startPolling();
    } else {
      this.stopPolling();
      if (wasRunning && storage.migration.error === null) {
        this.errorService.success(
          storage.migration.stopped
            ? 'Stopped moving images'
            : 'All images are moved',
        );
      }
    }
  }

  private startPolling() {
    if (this.migrationTimer !== null) return;
    this.migrationTimer = setInterval(async () => {
      const storage = await this.serverSettings.getStorage();
      if (!HasFailed(storage)) this.showStorage(storage);
    }, 1000);
  }

  private stopPolling() {
    if (this.migrationTimer === null) return;
    clearInterval(this.migrationTimer);
    this.migrationTimer = null;
  }

  // What the form shows for a setting
  private formValue(key: ServerSetting, state: ServerSettingState): string {
    switch (key) {
      case ServerSetting.StorageDriver:
      case ServerSetting.S3ForcePathStyle:
        // A select and a toggle, which always have a value
        return state.value ?? state.default ?? '';
      case ServerSetting.MaxFileSize:
        return state.value === null ? '' : bytesToMb(state.value);
      default:
        return state.value ?? '';
    }
  }

  // The settings that differ from what was loaded, of the given ones
  private changes(
    keys: ServerSetting[] = ServerSettingList,
  ): Record<string, string | null> {
    const changes: Record<string, string | null> = {};

    for (const key of keys) {
      const control = this.form.controls[key];
      if (control.disabled) continue;

      if (SecretServerSettings.includes(key)) {
        if (control.value !== '') changes[key] = control.value;
        else if (this.removeSecret) changes[key] = null;
        continue;
      }

      if (control.value === this.initial[key]) continue;
      const input = control.value.trim();
      let value: string | null =
        input === ''
          ? null
          : key === ServerSetting.MaxFileSize
            ? mbToBytes(input)
            : input;

      // A select and a toggle can only go back to the default by choosing it
      const state = this.state(key);
      if (
        (key === ServerSetting.StorageDriver ||
          key === ServerSetting.S3ForcePathStyle) &&
        value === state?.default
      ) {
        value = null;
      }
      const stored = state?.source === 'settings' ? state.value : null;
      if (value !== stored) changes[key] = value;
    }

    return changes;
  }

  private validate(
    key: ServerSetting,
    control: AbstractControl,
  ): { error: string } | null {
    const value = String(control.value ?? '').trim();
    if (value === '') return null;

    if (key === ServerSetting.MaxFileSize) {
      const bytes = mbToBytes(value);
      if (
        bytes === null ||
        !ServerSettingValidators[key].safeParse(bytes).success
      ) {
        return { error: 'Should be a size in MB, like 128' };
      }
      return null;
    }

    const result = ServerSettingValidators[key].safeParse(value);
    if (!result.success) {
      return { error: result.error.issues[0]?.message ?? 'Invalid value' };
    }
    return null;
  }
}
