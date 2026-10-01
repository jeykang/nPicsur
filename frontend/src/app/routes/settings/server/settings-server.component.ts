import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { AbstractControl, FormControl, FormGroup } from '@angular/forms';
import {
  EnvironmentOption,
  ServerSettingState,
  ServerSettingsResponse,
  StorageStatusResponse,
} from 'picsur-shared/dist/dto/api/server.dto';
import {
  BoolServerSettings,
  LiveServerSettings,
  OidcSettings,
  SecretServerSettings,
  ServerSetting,
  ServerSettingList,
  ServerSettingValidators,
  StorageSettings,
} from 'picsur-shared/dist/dto/server-settings.dto';
import {
  ExternalStorageDriver,
  StorageDriver,
  StorageDriverList,
} from 'picsur-shared/dist/dto/storage-driver.enum';
import { Failure, HasFailed } from 'picsur-shared/dist/types/failable';
import {
  EnvironmentOptionUI,
  ServerSettingUI,
} from '../../../i18n/server-settings.i18n';
import { InfoService } from '../../../services/api/info.service';
import { ServerSettingsService } from '../../../services/api/server-settings.service';
import { Logger } from '../../../services/logger/logger.service';
import { DialogService } from '../../../util/dialog-manager/dialog.service';
import { ErrorService } from '../../../util/error-manager/error.service';

type SettingControls = { [key in ServerSetting]: FormControl<string> };

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
  return (
    StorageDriverList.find((driver) => driver === value) ??
    StorageDriver.Database
  );
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
  public readonly Driver = StorageDriver;
  public readonly storageName = StorageName;

  public settings: ServerSettingsResponse | null = null;
  public storage: StorageStatusResponse | null = null;
  public loadFailure: Failure | null = null;

  public readonly form: FormGroup<SettingControls>;
  // What the form showed when the settings were loaded
  private initial: Partial<Record<ServerSetting, string>> = {};
  // Saved secrets that are to be removed
  public readonly removeSecrets = new Set<ServerSetting>();
  // Settings whose saved value is to be removed, so the environment applies
  private readonly useEnv = new Set<ServerSetting>();
  // Why the directory that was tested might not be safe for images
  public pathWarning: string | null = null;

  public busy: 'saving' | 'testing' | 'restarting' | 'migrating' | null = null;
  public testing: ExternalStorageDriver | 'oidc' | null = null;
  private migrationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly serverSettings: ServerSettingsService,
    private readonly infoService: InfoService,
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

  // What a setting is for, how secrets are protected, and whether an
  // environment variable sets it when nothing is saved here
  public hint(key: ServerSetting): string {
    let hint = ServerSettingUI[key].helpText;
    if (SecretServerSettings.includes(key)) {
      switch (this.settings?.encryption_key) {
        case 'environment':
          hint +=
            ' It is saved encrypted with PICSUR_ENCRYPTION_KEY, which is not stored in the database.';
          break;
        case 'database':
          hint +=
            ' It is saved encrypted, but with a key kept in the database as well, so a copy of the database reveals it. Setting PICSUR_ENCRYPTION_KEY prevents that, see the README.';
          break;
        default:
          hint =
            'Secrets cannot be saved right now, there is no key to encrypt them with. The server log says why.';
      }
    }

    if (LiveServerSettings.includes(key)) hint += ' Takes effect right away.';

    const state = this.state(key);
    if (state?.env_set) {
      hint += state.saved
        ? ` Saved here, which comes before ${state.env} in the environment.`
        : ` Set with ${state.env}, unless something is saved here.`;
    }
    return hint;
  }

  // What can only be set with environment variables, as shown on the page
  public get environment(): { name: string; env: string; value: string }[] {
    return (this.settings?.environment ?? []).map((option) => ({
      name: EnvironmentOptionUI[option.env] ?? option.env,
      env: option.env,
      value: this.environmentValue(option),
    }));
  }

  // Environment variables that are not used, as something is saved here for
  // their settings
  public get overriddenEnv(): string[] {
    return (this.settings?.settings ?? [])
      .filter((s) => s.saved && s.env_set)
      .map((s) => s.env);
  }

  public state(key: ServerSetting): ServerSettingState | null {
    return this.settings?.settings.find((s) => s.key === key) ?? null;
  }

  // Secrets can only be saved with a key to encrypt them with
  public locked(key: ServerSetting): boolean {
    return (
      SecretServerSettings.includes(key) &&
      this.settings?.encryption_key === null
    );
  }

  public saved(key: ServerSetting): boolean {
    return this.state(key)?.saved ?? false;
  }

  // What applies when nothing is saved here
  private fallback(key: ServerSetting): string | null {
    const state = this.state(key);
    return state?.env_value ?? state?.default ?? null;
  }

  public placeholder(key: ServerSetting): string {
    const state = this.state(key);
    if (state === null) return '';
    if (SecretServerSettings.includes(key)) {
      if (state.saved && !this.removeSecrets.has(key)) {
        return 'Saved, leave empty to keep it';
      }
      return state.env_set ? `Set with ${state.env}` : '';
    }
    const fallback = this.fallback(key);
    if (fallback === null) return '';
    return key === ServerSetting.MaxFileSize ? bytesToMb(fallback) : fallback;
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

  // Where the provider sends users back to, to be registered there
  public get oidcRedirectUri(): string {
    const override = this.infoService.snapshot.host_override;
    let origin = window.location.origin;
    try {
      if (override) origin = new URL(override).origin;
    } catch {
      // The address of the page it is
    }
    return origin + '/user/oidc';
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

  // Removes what is saved for the settings environment variables set, so
  // those apply again once saved
  public useEnvironment() {
    for (const env of this.overriddenEnv) {
      const key = this.settings?.settings.find((s) => s.env === env)
        ?.key as ServerSetting;
      if (SecretServerSettings.includes(key)) {
        this.removeSecrets.add(key);
        this.form.controls[key].setValue('');
        continue;
      }
      const control = this.form.controls[key];
      control.setValue(
        key === ServerSetting.StorageDriver || BoolServerSettings.includes(key)
          ? (this.fallback(key) ?? '')
          : '',
      );
      control.markAsDirty();
      // Also when what is saved is what the environment sets
      this.useEnv.add(key);
    }
  }

  public toggleRemoveSecret(key: ServerSetting) {
    if (this.removeSecrets.has(key)) this.removeSecrets.delete(key);
    else this.removeSecrets.add(key);
    this.form.controls[key].setValue('');
  }

  public setToggle(key: ServerSetting, on: boolean) {
    const control = this.form.controls[key];
    control.setValue(on ? 'true' : 'false');
    control.markAsDirty();
  }

  // Removes all saved bucket settings, to be saved
  public removeBucket() {
    for (const key of StorageSettings) {
      if (
        key === ServerSetting.StorageDriver ||
        key === ServerSetting.StoragePath ||
        key === ServerSetting.S3SecretAccessKey
      ) {
        continue;
      }
      const control = this.form.controls[key];
      control.setValue(
        key === ServerSetting.S3ForcePathStyle
          ? (this.fallback(key) ?? 'false')
          : '',
      );
      control.markAsDirty();
    }
    if (this.saved(ServerSetting.S3SecretAccessKey)) {
      this.removeSecrets.add(ServerSetting.S3SecretAccessKey);
    }
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
    // Links to images use it
    if (ServerSetting.HostOverride in changes) {
      await this.infoService.updateInfo();
    }
    // Changes that take effect right away need no restart, even while
    // earlier ones still wait for one
    const restartFor = Object.keys(changes).some(
      (key) => !LiveServerSettings.includes(key as ServerSetting),
    );
    if (!result.restart_needed || !restartFor) {
      this.errorService.success('Saved');
      return;
    }
    await this.promptRestart();
  }

  async testStorage(storage: ExternalStorageDriver) {
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

  async testOidc() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.busy = 'testing';
    this.testing = 'oidc';
    const result = await this.serverSettings.testOidc(
      this.changes(OidcSettings),
    );
    this.busy = null;
    this.testing = null;
    if (HasFailed(result)) {
      return this.errorService.showFailure(result, this.logger);
    }
    this.errorService.success(`Found the provider ${result.issuer}`);
  }

  async promptRestart() {
    if (this.settings === null || this.storage === null) return;

    // Where new images go once restarted
    const next = AsDriver(
      this.state(ServerSetting.StorageDriver)?.value ??
        this.fallback(ServerSetting.StorageDriver),
    );
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

  private environmentValue(option: EnvironmentOption): string {
    if (option.value !== null) {
      return option.set ? option.value : `${option.value}, the default`;
    }
    // Secrets
    if (option.set) return 'Set';
    switch (option.env) {
      case 'PICSUR_JWT_SECRET':
        return 'Generated, kept in the database';
      case 'PICSUR_ENCRYPTION_KEY':
        return this.settings?.encryption_key === 'database'
          ? 'Generated, kept in the database'
          : 'None, secrets cannot be saved';
      default:
        return 'The default';
    }
  }

  private filesNotIn(driver: StorageDriver): number {
    if (this.storage === null) return 0;
    return StorageDriverList.filter((other) => other !== driver).reduce(
      (total, other) => total + this.storage!.files[other],
      0,
    );
  }

  private showSettings(settings: ServerSettingsResponse) {
    this.settings = settings;
    this.removeSecrets.clear();
    this.useEnv.clear();
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
        SecretServerSettings.includes(key) &&
        settings.encryption_key === null
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

  // What the form shows for a setting: what is saved here, and for toggles
  // (BoolServerSettings) and the select, which always have a value, what
  // applies otherwise
  private formValue(key: ServerSetting, state: ServerSettingState): string {
    const always = state.value ?? state.env_value ?? state.default ?? '';
    if (BoolServerSettings.includes(key)) return always;
    switch (key) {
      case ServerSetting.StorageDriver:
        return always;
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
        else if (this.removeSecrets.has(key)) changes[key] = null;
        continue;
      }

      if (control.value === this.initial[key] && !this.useEnv.has(key)) {
        continue;
      }
      const input = control.value.trim();
      let value: string | null =
        input === ''
          ? null
          : key === ServerSetting.MaxFileSize
            ? mbToBytes(input)
            : input;

      // The select and toggles show what applies without saving anything,
      // choosing that saves nothing
      if (
        (key === ServerSetting.StorageDriver ||
          BoolServerSettings.includes(key)) &&
        value === this.fallback(key)
      ) {
        value = null;
      }
      const state = this.state(key);
      const stored = state?.saved ? state.value : null;
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
