import { Client, expectSuccess } from './client.js';

// The server settings, as the settings page gets them

export interface SettingState {
  key: string;
  value: string | null;
  saved: boolean;
  env: string;
  env_value: string | null;
  env_set: boolean;
  default: string | null;
  source: 'settings' | 'environment' | 'default';
  set: boolean;
}

export interface EnvironmentOption {
  env: string;
  value: string | null;
  set: boolean;
}

export interface SettingsResponse {
  settings: SettingState[];
  environment: EnvironmentOption[];
  restart_needed: boolean;
  restart_error: string | null;
  started_at: string;
  encryption_key: 'environment' | 'database' | null;
}

export function setting(settings: SettingsResponse, key: string): SettingState {
  const state = settings.settings.find((s) => s.key === key);
  if (state === undefined) throw new Error(`No setting ${key}`);
  return state;
}

export async function getSettings(client: Client): Promise<SettingsResponse> {
  return expectSuccess(await client.get('/api/server/settings'));
}

export async function update(
  client: Client,
  values: Record<string, string | null>,
) {
  return client.post('/api/server/settings', { values });
}

// Restarts the server, and waits until it is back
export async function restart(client: Client): Promise<SettingsResponse> {
  const before = expectSuccess(await client.post('/api/server/restart'))
    .started_at as string;

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const res = await client.get('/api/server/settings').catch(() => null);
    if (res?.json?.success && res.json.data.started_at !== before) {
      return res.json.data;
    }
  }
  throw new Error('Picsur did not come back after restarting');
}
