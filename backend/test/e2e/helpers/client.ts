import { randomInt } from 'node:crypto';
import { inject } from 'vitest';

export interface ApiResponse<T = any> {
  status: number;
  headers: Headers;
  // The parsed body for JSON responses
  json: T;
  // The raw body, for images and other binary responses
  body: Buffer;
}

export interface RequestOptions {
  body?: unknown;
  form?: FormData;
  // Sent as is, for testing malformed requests
  raw?: string;
  headers?: Record<string, string>;
  // Do not follow redirects, so they can be inspected
  manualRedirect?: boolean;
}

// Requests pretend to come from a random address (the backend trusts
// X-Forwarded-For from localhost), so the rate limits do not get in the way of
// the tests. Tests for the rate limits pin the address of their client.
function randomClientIp() {
  return `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}

export class Client {
  public readonly baseUrl = inject('baseUrl');
  // When set, every request comes from this address
  public pinnedIp: string | undefined;

  private token: string | undefined;
  private apiKey: string | undefined;

  static guest() {
    return new Client();
  }

  // A client that always uses the same address, for testing rate limits
  static pinned() {
    const client = new Client();
    client.pinnedIp = randomClientIp();
    return client;
  }

  static async admin() {
    const client = new Client();
    await client.login('admin', inject('adminPassword'));
    return client;
  }

  static async user(username: string, password: string) {
    const client = new Client();
    await client.login(username, password);
    return client;
  }

  static withApiKey(apiKey: string) {
    const client = new Client();
    client.apiKey = apiKey;
    return client;
  }

  get jwt() {
    return this.token;
  }

  set jwt(token: string | undefined) {
    this.token = token;
  }

  async login(username: string, password: string) {
    const res = await this.post('/api/user/login', { username, password });
    if (res.json?.success !== true) {
      throw new Error(
        `Login as ${username} failed: ${JSON.stringify(res.json?.data)}`,
      );
    }
    this.token = res.json.data.jwt_token;
    return res;
  }

  async request<T = any>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'X-Forwarded-For': this.pinnedIp ?? randomClientIp(),
      ...options.headers,
    };
    if (this.apiKey) headers['Authorization'] = `Api-Key ${this.apiKey}`;
    else if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    let body: BodyInit | undefined;
    if (options.form) {
      body = options.form;
    } else if (options.raw !== undefined) {
      body = options.raw;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const res = await fetch(this.baseUrl + path, {
      method,
      headers,
      body,
      redirect: options.manualRedirect ? 'manual' : 'follow',
    });

    const raw = Buffer.from(await res.arrayBuffer());
    let json: any = undefined;
    if (res.headers.get('content-type')?.includes('application/json')) {
      json = JSON.parse(raw.toString('utf8'));
    }

    return { status: res.status, headers: res.headers, json, body: raw };
  }

  get<T = any>(path: string, options?: RequestOptions) {
    return this.request<T>('GET', path, options);
  }

  head<T = any>(path: string, options?: RequestOptions) {
    return this.request<T>('HEAD', path, options);
  }

  post<T = any>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('POST', path, { ...options, body });
  }

  async upload(image: Buffer, filename = 'image.png') {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(image)]), filename);
    return this.request('POST', '/api/image/upload', { form });
  }

  // Upload an image and return its id, failing the test when it doesn't work
  async uploadOk(image: Buffer, filename = 'image.png') {
    const res = await this.upload(image, filename);
    if (res.json?.success !== true) {
      throw new Error(`Upload failed: ${JSON.stringify(res.json)}`);
    }
    return res.json.data as {
      id: string;
      user_id: string;
      file_name: string;
      delete_key?: string;
    };
  }
}

export function uniqueName(prefix = 'user') {
  // Usernames are alphanumeric, 4 to 32 characters
  return `${prefix}${Date.now().toString(36)}${randomInt(0, 1e6).toString(36)}`;
}

// Creates a user through the admin api and returns a client logged in as it
export async function createUser(
  admin: Client,
  roles: string[] = [],
  password = 'correct-horse',
) {
  const username = uniqueName();
  const res = await admin.post('/api/user/create', {
    username,
    password,
    roles,
  });
  if (res.json?.success !== true) {
    throw new Error(`Creating user failed: ${JSON.stringify(res.json)}`);
  }
  const client = await Client.user(username, password);
  return {
    client,
    id: res.json.data.id as string,
    username,
    password,
  };
}

// Assert helper for the standard response envelope
export function expectSuccess<T = any>(res: ApiResponse): T {
  if (res.json?.success !== true) {
    throw new Error(
      `Expected success, got HTTP ${res.status}: ${JSON.stringify(res.json)}`,
    );
  }
  return res.json.data;
}

export function expectFailure(res: ApiResponse, status: number, type?: string) {
  if (res.json?.success !== false) {
    throw new Error(
      `Expected failure, got HTTP ${res.status}: ${JSON.stringify(res.json)}`,
    );
  }
  if (res.status !== status || (type && res.json.data.type !== type)) {
    throw new Error(
      `Expected HTTP ${status}${type ? ` (${type})` : ''}, got HTTP ${
        res.status
      } (${res.json.data.type}): ${res.json.data.message}`,
    );
  }
  return res.json.data as { type: string; message: string };
}
