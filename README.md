<img align="left" width="100" height="100" style="border-radius: 15%" src="branding/logo/picsur.svg"/>

# Picsur

> Totally not an Imgur clone

A self-hosted image sharing service inspired by Imgur and Pastebin.

**nPicsur** is a maintained fork of [Picsur](https://github.com/CaramelFur/Picsur), created by Caramel. It adds storage options, security fixes, updated dependencies, and a tested Docker image.

## What changed in this fork

- **Storage options:** store images in the database, [on disk](#storing-images-on-disk), or [in S3](#storing-images-in-s3). Move existing images between them from Settings → Server.
- **Security fixes:**
  - Users managing accounts, roles, or API keys can only grant permissions they hold themselves.
  - Rate limits now restrict requests and image conversions.
  - Changing a password now logs that user out everywhere.
  - Deletion links ask for confirmation, so link previews in chat apps no longer delete images.
  - New instances generate a random admin password unless `PICSUR_ADMIN_PASSWORD` is set.
  - API keys are hashed, shown only at creation, and cannot be exchanged for login tokens.
- **New features:** albums, a public gallery, a light theme, password changes, OpenID Connect login, and a server settings page.
- **Telemetry removed:** instances no longer report their hostname, user count, or image count to the original author.
- **Updated dependencies:** Node.js 24, NestJS 12, and Fastify 5 for the server; Angular 22 for the frontend.
- **Docker image** for amd64 and arm64 with HEIC (iPhone photos), JPEG XL and JPEG 2000 support. It is tested in CI before it is published.
- **End-to-end tests:** CI covers database, S3, and filesystem storage, plus the Docker image.

## Features

- Uploading and viewing images, anonymously or with an account
- User accounts, with roles and permissions
- OpenID Connect login through providers such as Authelia, Authentik, or Keycloak, with optional password login
- Image formats: QOI, JPEG, PNG, APNG, WebP, GIF, TIFF, AVIF, HEIF/HEIC, BMP, ICO, TGA, JPEG XL, and JPEG 2000, including animated PNG, WebP, and GIF
- Converting and customizing images through the URL: resize, rotate, flip, strip transparency, negative, greyscale
- EXIF stripping, with the option to keep the original file
- Expiring images, and deleting images with a secret deletion link
- Correct previews in chat apps
- A ShareX configuration builder, and API keys
- Images stored in the database, in S3 compatible object storage, or in a directory on disk
- Shareable albums
- An opt-in public gallery
- A dark and a light theme

## Running your own instance

Run Picsur alongside a Postgres database with this `docker-compose.yml`. See [`support/picsur.docker-compose.yml`](support/picsur.docker-compose.yml) for all options.

```yaml
services:
  picsur:
    image: ghcr.io/jeykang/npicsur:latest
    container_name: picsur
    ports:
      - '8080:8080'
    environment:
      PICSUR_DB_HOST: picsur_postgres
      # PICSUR_ADMIN_PASSWORD: CHANGE_ME
    restart: unless-stopped
    depends_on:
      - picsur_postgres
  picsur_postgres:
    image: postgres:17-alpine
    container_name: picsur_postgres
    environment:
      POSTGRES_DB: picsur
      POSTGRES_PASSWORD: picsur
      POSTGRES_USER: picsur
    restart: unless-stopped
    volumes:
      - picsur-data:/var/lib/postgresql/data
volumes:
  picsur-data:
```

Start the services with `docker compose up -d`, then open <http://localhost:8080> and log in as `admin`. If `PICSUR_ADMIN_PASSWORD` is unset, Picsur generates a password on first start and prints it in the log:

```sh
docker logs picsur 2>&1 | grep -i password
```

Use a reverse proxy with HTTPS. Clipboard buttons require HTTPS or localhost.

The `latest` tag tracks releases; `edge` tracks master.

### Configuration

Set these options through environment variables. They configure startup or let you supply secrets separately from the database:

| Variable                      | Default                             | Description                                                                                                                                       |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PICSUR_DB_HOST`              | `localhost`                         | Postgres server                                                                                                                                   |
| `PICSUR_DB_PORT`              | `5432`                              |                                                                                                                                                   |
| `PICSUR_DB_USERNAME`          | `picsur`                            |                                                                                                                                                   |
| `PICSUR_DB_PASSWORD`          | `picsur`                            |                                                                                                                                                   |
| `PICSUR_DB_DATABASE`          | `picsur`                            |                                                                                                                                                   |
| `PICSUR_ADMIN_PASSWORD`       | random, printed in the log          | Initial admin password; change it later under Settings → Account                                                                                  |
| `PICSUR_JWT_SECRET`           | generated, stored in the db         | Signs login tokens. Anyone with this secret can impersonate any user                                                                              |
| `PICSUR_ENCRYPTION_KEY`       | generated, stored in the db         | Encrypts saved secrets. Set it to keep the encryption key out of the database; see below                                                          |
| `PICSUR_HOST` / `PICSUR_PORT` | `0.0.0.0` / `8080`                  | Where the server listens                                                                                                                          |
| `PICSUR_BASE_PATH`            | the root                            | Path Picsur is served under behind a reverse proxy, such as `/picsur`. See [Serving Picsur under a path](#serving-picsur-under-a-path)            |
| `PICSUR_STATIC_FRONTEND_ROOT` | the built in frontend               | Only needed for a custom frontend                                                                                                                 |
| `PICSUR_PRODUCTION`           | `false`, `true` in the Docker image | Set to `true` outside development. Development mode syncs tables to the code and enables verbose logging                                          |
| `PICSUR_DEMO`                 | `false`                             | Demo mode: guests can upload, and all images are deleted every `PICSUR_DEMO_INTERVAL` milliseconds. The guest role keeps the permission to upload |
| `PICSUR_DEMO_INTERVAL`        | `300000`, 5 minutes                 |                                                                                                                                                   |

Configure the remaining options under Settings → Server or through environment variables:

| Variable                            | Default                             | Description                                                                                                                                                                                                |
| ----------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PICSUR_STORAGE_DRIVER`             | `database`                          | Where new images are stored, `database`, `s3` or `filesystem`                                                                                                                                              |
| `PICSUR_STORAGE_PATH`               |                                     | See [Storing images on disk](#storing-images-on-disk)                                                                                                                                                      |
| `PICSUR_S3_*`                       |                                     | See [Storing images in S3](#storing-images-in-s3)                                                                                                                                                          |
| `PICSUR_MAX_FILE_SIZE`              | `128000000`                         | Largest accepted upload, in bytes                                                                                                                                                                          |
| `PICSUR_GUEST_UPLOAD_EXPIRY`        | `0`                                 | Maximum lifetime of anonymous uploads, such as `1d`. `0` imposes no expiry limit                                                                                                                           |
| `PICSUR_MAX_CONCURRENT_CONVERSIONS` | number of CPUs                      | Maximum concurrent conversions; additional requests wait                                                                                                                                                   |
| `PICSUR_CONVERSION_RATE_LIMIT`      | `120`                               | New conversions a single visitor may start per minute, `0` for no limit                                                                                                                                    |
| `PICSUR_CONVERSION_TIME_LIMIT`      | `15s`                               | Time limit per conversion, up to `10m`                                                                                                                                                                     |
| `PICSUR_CONVERSION_MEMORY_LIMIT`    | `512`                               | Memory limit per conversion, in MB                                                                                                                                                                         |
| `PICSUR_ALLOW_EDITING`              | `true`                              | Allow resizing, rotation, and other URL edits. Format conversion is always available                                                                                                                       |
| `PICSUR_REMOVE_DERIVATIVES_AFTER`   | `7d`                                | Remove converted versions after this idle period; recreate them on demand. `0` disables cleanup                                                                                                            |
| `PICSUR_TRUST_PROXY`                | loopback and private IPv4 addresses | Proxies trusted to supply `X-Forwarded-For` for rate limiting. Accepts `true`, `false`, or a comma-separated list of addresses, ranges, and names: `loopback`, `linklocal`, `uniquelocal` (including IPv6) |
| `PICSUR_HOST_OVERRIDE`              | the browser's                       | Public URL, such as `https://images.example.com`, used for image links and provider login. Include the base path, if any                                                                                   |
| `PICSUR_OIDC_*`                     |                                     | See [Logging in with OpenID Connect](#logging-in-with-openid-connect)                                                                                                                                      |
| `PICSUR_PASSWORD_LOGIN`             | `true`                              | Whether users can log in with a password, see [Logging in with OpenID Connect](#logging-in-with-openid-connect)                                                                                            |
| `PICSUR_JWT_EXPIRY`                 | `7d`                                | Login expiry after inactivity                                                                                                                                                                              |
| `PICSUR_BCRYPT_STRENGTH`            | `10`                                | Password hashing cost, from 4 to 15. Each step doubles hashing time                                                                                                                                        |
| `PICSUR_TRACKING_URL`               |                                     | [Ackee](https://github.com/electerious/Ackee) server URL; Picsur proxies visit reports                                                                                                                     |
| `PICSUR_TRACKING_ID`                |                                     | Ackee website ID; tracking requires both the URL and ID                                                                                                                                                    |
| `PICSUR_VERBOSE`                    | `false`                             | More logging, which might include sensitive data                                                                                                                                                           |

Use durations such as `15s`, `30m`, `12h`, or `7d`. Boolean values accept `true`, `false`, `yes`, `no`, `1`, or `0`. You can also use a `.env` file in the working directory; process environment variables take precedence.

Image conversion workers handle untrusted files, so they receive only libvips and sharp variables (`VIPS_*` and `SHARP_*`), such as `VIPS_CONCURRENCY`.

Saved settings override environment variables. Settings → Server lists overridden variables and lets you restore their values. It also shows options that can only be set through the environment.

`PICSUR_CONVERSION_TIME_LIMIT`, `PICSUR_CONVERSION_MEMORY_LIMIT`, `PICSUR_ALLOW_EDITING`, `PICSUR_REMOVE_DERIVATIVES_AFTER`, `PICSUR_GUEST_UPLOAD_EXPIRY`, `PICSUR_HOST_OVERRIDE`, `PICSUR_JWT_EXPIRY`, `PICSUR_BCRYPT_STRENGTH`, and `PICSUR_TRACKING_*` take effect when saved. Other settings require a restart, which you can trigger from the page. If startup fails, Picsur restores the previous settings.

Use the CLI to inspect setting sources or reset a setting to its environment value or default. Restart Picsur after resetting:

```sh
docker exec picsur node backend/dist/cli.js settings list
docker exec picsur node backend/dist/cli.js settings reset max_file_size
```

Secrets saved on the settings page are encrypted. By default, the encryption key is stored in the database, so anyone with a database copy can still decrypt them.

To keep the key separate, set `PICSUR_ENCRYPTION_KEY` to a random value, such as the output of `openssl rand -base64 32`. On the next start, Picsur re-encrypts existing secrets with this key and removes the old database key. Back up your key separately: without it, you must enter the secrets again.

Encrypted values use the format `enc:v1:env:...` or `enc:v1:db:...`. See [`settings-encryption.ts`](backend/src/config/settings-encryption.ts) for the format and manual decryption details.

## Serving Picsur under a path

Picsur can share an address with other sites, such as `https://example.com/picsur/`. Set `PICSUR_BASE_PATH` to the path:

```yaml
services:
  picsur:
    # ...
    environment:
      PICSUR_BASE_PATH: /picsur
```

The path can contain multiple segments, such as `/apps/picsur`. Its first segment must not be `api`, `i`, `assets`, or `media`, which Picsur uses for its own routes and files.

The reverse proxy can pass the path on or remove it. With Nginx:

```nginx
location /picsur/ {
    client_max_body_size 128m;
    proxy_pass http://127.0.0.1:8080/;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Nginx redirects `/picsur` to `/picsur/` automatically, preserving the query string. `$http_host` keeps the port in generated links when the public address uses a non-standard port.

If you set a public address, include the path, as in `https://example.com/picsur`. For OpenID Connect, register `https://example.com/picsur/user/oidc` with the provider; Settings → Server shows the exact URI.

Sites on the same address can read each other's browser storage, including Picsur's login. Share an address only with sites you trust.

## Storing images on disk

Store image files in a directory while keeping metadata in Postgres. Back up both the directory and the database.

Mount a volume at `/picsur/images`:

```yaml
services:
  picsur:
    # ...
    volumes:
      - picsur-images:/picsur/images
volumes:
  picsur-data:
  picsur-images:
```

For a host directory, use a bind mount such as `./images:/picsur/images`. Picsur runs as user 1000 and needs write access; set ownership with `sudo chown 1000:1000 images`.

Under Settings → Server, select **Directory on disk** and enter `/picsur/images`. Test the directory, then save and restart. You can then move existing images there. The test warns if the directory is outside a volume, where replacing the container would lose the files.

Equivalent environment variables:

| Variable                | Description                                       |
| ----------------------- | ------------------------------------------------- |
| `PICSUR_STORAGE_DRIVER` | `filesystem` to store new images in the directory |
| `PICSUR_STORAGE_PATH`   | Absolute directory path; created if needed        |

Files are written to a temporary name and renamed after the write completes, preventing partial images after an interrupted write. Image data is stored at `images/<image id>/master`; converted versions are under `images/<image id>/derivatives/`.

The settings page only allows changing the directory when it is empty. To move files manually, stop Picsur, move the directory, and update `PICSUR_STORAGE_PATH`.

## Storing images in S3

Store image files in S3 compatible storage, such as AWS S3, Garage, MinIO, or RustFS. Metadata stays in Postgres.

Under Settings → Server:

1. Select **S3 compatible object storage** and enter the bucket details. Enable path style addressing for MinIO and most other self-hosted services.
2. Test the connection. This creates the bucket if needed.
3. Save and restart. Picsur can then move existing images to the bucket while continuing to serve requests. The page shows migration progress.

Use the same steps to move back to the database or to disk. A bucket must be empty before you can change or remove its configuration.

The secret access key is encrypted. See [Configuration](#configuration) to protect it from database copies.

Environment variables apply when no value is saved on the settings page:

| Variable                      | Description                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `PICSUR_STORAGE_DRIVER`       | `s3` to store new images in the bucket                                       |
| `PICSUR_S3_BUCKET`            | Bucket name; created if needed                                               |
| `PICSUR_S3_REGION`            | Defaults to `us-east-1`                                                      |
| `PICSUR_S3_ENDPOINT`          | Custom endpoint, such as `https://s3.example.com`; omit for AWS S3           |
| `PICSUR_S3_FORCE_PATH_STYLE`  | `true` for `https://host/bucket` URLs, required by most self-hosted services |
| `PICSUR_S3_ACCESS_KEY_ID`     | Credentials; defaults to the AWS credential chain if unset                   |
| `PICSUR_S3_SECRET_ACCESS_KEY` |                                                                              |
| `PICSUR_S3_PREFIX`            | Keep Picsur's objects under this path in the bucket, like `picsur/`          |

Changing the storage destination only affects new images. Existing images remain accessible as long as their storage is configured. Move them from the settings page or with the CLI:

```sh
# Where image data is stored right now
docker exec picsur node backend/dist/cli.js storage status

# Move existing images to the current storage destination.
# Safe to run while Picsur is active; rerun to resume an interrupted migration.
docker exec picsur node backend/dist/cli.js storage migrate

# Delete unused files from the bucket or directory.
# Files under an hour old are skipped to protect uploads in progress.
# Use --min-age <seconds> to change this cutoff.
docker exec picsur node backend/dist/cli.js storage gc --dry-run
docker exec picsur node backend/dist/cli.js storage gc
```

## Logging in with OpenID Connect

OpenID Connect lets users log in through Authelia, Authentik, Keycloak, Pocket ID, Google, or another compatible provider. You can keep password login enabled or turn it off. Picsur uses [openid-client](https://github.com/panva/openid-client).

### At the provider

Create a confidential client (web application) using the authorization code flow:

- **Redirect URI:** `https://picsur.example.com/user/oidc`. Use the exact URI shown in Settings → Server, without wildcards. It uses your configured public address, if set.
- **Scopes**: `openid profile email`.
- **PKCE:** `S256` (always enabled).
- **Client authentication:** `client_secret_basic`, falling back to `client_secret_post` if the provider does not support it.

For Authelia, a client in its configuration looks like this:

```yaml
identity_providers:
  oidc:
    clients:
      - client_id: 'picsur'
        client_name: 'Picsur'
        # The digest of the secret you give Picsur
        client_secret: '$pbkdf2-sha512$310000$...'
        public: false
        authorization_policy: 'two_factor'
        require_pkce: true
        pkce_challenge_method: 'S256'
        redirect_uris:
          - 'https://picsur.example.com/user/oidc'
        scopes:
          - 'openid'
          - 'profile'
          - 'email'
        response_types:
          - 'code'
        grant_types:
          - 'authorization_code'
        access_token_signed_response_alg: 'none'
        userinfo_signed_response_alg: 'none'
        token_endpoint_auth_method: 'client_secret_basic'
```

Generate the secret for Picsur and its digest for Authelia with `authelia crypto hash generate pbkdf2 --variant sha512 --random --random.length 72 --random.charset rfc3986`. See [Authelia’s documentation](https://www.authelia.com/integration/openid-connect/frequently-asked-questions/#client-secret).

### In Picsur

Under Settings → Server → Login, enter the issuer URL (for example, `https://auth.example.com`), client ID, client secret, and provider name. Test the connection, save, and restart. The login page will show a button for the provider.

Existing users link their provider account under Settings → Account. Each provider account can link to one Picsur account, and vice versa. Links use the provider’s account ID, never a matching username or email address.

Enable **Create accounts for new users** to let provider users register automatically with the default roles. Otherwise, users must link an existing Picsur account first.

Only enable automatic registration if the provider restricts access to the intended users. Authelia requires a client authorization policy: its usual access control rules [do not apply to OpenID Connect](https://www.authelia.com/integration/openid-connect/frequently-asked-questions/#why-doesnt-the-access-control-configuration-work-with-openid-connect-10). This policy restricts access to the `picsur` group:

```yaml
identity_providers:
  oidc:
    authorization_policies:
      picsur:
        default_policy: 'deny'
        rules:
          - policy: 'two_factor'
            subject: 'group:picsur'
    clients:
      - client_id: 'picsur'
        authorization_policy: 'picsur'
        # And the rest as above
```

New accounts use the `preferred_username` claim, or your configured claim. Picsur removes characters other than letters and digits, and adds a number if the name is taken. These accounts have no password initially; users can set one under Settings → Account.

After linking your own account, you can disable **Password login**. This also disables password registration. If the provider becomes unavailable, reset the setting and restart Picsur to restore password login. If you disabled it through `PICSUR_PASSWORD_LOGIN`, remove that variable too:

```sh
docker exec picsur node backend/dist/cli.js settings reset password_login
docker restart picsur
```

Enable **Redirect to provider automatically** to skip the Picsur login page. You can still open it at `/user/login?local`.

The same can be set with environment variables:

| Variable                     | Description                                                                 |
| ---------------------------- | --------------------------------------------------------------------------- |
| `PICSUR_OIDC_ISSUER`         | The issuer of the provider, or the address of its discovery document        |
| `PICSUR_OIDC_CLIENT_ID`      |                                                                             |
| `PICSUR_OIDC_CLIENT_SECRET`  |                                                                             |
| `PICSUR_OIDC_NAME`           | Provider name on the login button. Defaults to `single sign-on`             |
| `PICSUR_OIDC_SCOPE`          | Defaults to `openid profile email`                                          |
| `PICSUR_OIDC_USERNAME_CLAIM` | The claim new accounts are named after, defaults to `preferred_username`    |
| `PICSUR_OIDC_AUTO_REGISTER`  | `true` to create accounts for new users                                     |
| `PICSUR_OIDC_AUTO_LAUNCH`    | `true` to redirect to the provider automatically                            |
| `PICSUR_PASSWORD_LOGIN`      | `false` to turn off password login, which only works with a provider set up |

Account links are specific to a provider. While password login is disabled, Picsur prevents changing the provider or unlinking accounts to avoid locking users out.

## Upgrading from Picsur 0.5

1. Back up the database, for example with `docker exec picsur_postgres pg_dump -U picsur picsur > picsur.sql`.
2. Change the image to `ghcr.io/jeykang/npicsur:latest`, and start it. The database is upgraded automatically.
3. Accounts and passwords stay as they are. If the admin password is still the old default `picsur`, Picsur warns about it in the log: change it in the settings.

Changes to existing behavior:

- Deleting a user also deletes their images. To remove images left by users deleted in Picsur 0.5:

  ```sh
  docker exec picsur node backend/dist/cli.js images delete-orphaned --dry-run
  docker exec picsur node backend/dist/cli.js images delete-orphaned
  ```

- Deletion links open a page that asks for confirmation. Links saved by ShareX keep working.
- The public gallery starts empty. Users choose which images to include. The guest and user roles receive the “View the gallery” permission.
- The token from `/api/user/me` is empty when authenticated with an API key. API keys are used directly instead.
- API keys are shown only at creation. Existing keys and ShareX configs still work. Each new ShareX config gets its own key.
- The image metadata (`/i/meta/:id`) only shows the uploader's id and username.
- The statistics proxy (`/api/usage/report`) only accepts JSON.
- System settings move to Settings → Server automatically. Saved values override environment variables, including `PICSUR_JWT_EXPIRY`. See [Configuration](#configuration).
- Ackee tracking requires both a server URL and website ID. The separate enable switch has been removed.

## Upgrading Postgres

Postgres 14 [reaches end of support](https://www.postgresql.org/support/versioning/) on 12 November 2026. Major upgrades require migrating the database ([Postgres documentation](https://www.postgresql.org/docs/current/upgrading.html)). Images stored in S3 stay in the bucket, keeping the database migration small.

1. Stop Picsur and export the database:

   ```sh
   docker compose stop picsur
   docker exec picsur_postgres pg_dump -U picsur picsur > picsur.sql
   ```

2. Change the image to `postgres:17-alpine` and use a new volume, such as `picsur-data17:/var/lib/postgresql/data`. Declare it under `volumes:` too. Keep the same `POSTGRES_PASSWORD` and retain the old volume until you verify the upgrade.
3. Start the new Postgres, and wait until `docker logs picsur_postgres` says `PostgreSQL init process complete`.

   ```sh
   docker compose up -d picsur_postgres
   ```

4. Import the database, and start Picsur again:

   ```sh
   docker exec -i picsur_postgres psql -U picsur -d picsur < picsur.sql
   docker compose up -d
   ```

## FAQ

### How do I allow users to register their own accounts?

Registration is disabled by default to prevent unintended public uploads.

Under Settings → Roles, edit the guest role and grant **Register**. The login page will then show a registration button.

### How do I show images in the gallery, or close it?

Edit an image and enable **Show in the public gallery**. Anyone with the **View the gallery** permission can find it there, including guests by default. Other images are accessible through their links.

To restrict the gallery, remove **View the gallery** from the guest role under Settings → Roles. Remove it from the user role too to restrict access to admins and any custom roles that still have the permission.

### How do I make images expire by themselves?

Set **New images expire after** under Settings → Preferences. It applies to future uploads; you can change each image’s expiry later. Set a separate expiry when exporting a ShareX config, or use `/api/image/upload?expires_after=<seconds>` for API uploads. Use `0` for no expiry.

**Guest uploads expire after**, under Settings → Server, sets the maximum lifetime for anonymous uploads.

### How do I keep original files?

Picsur strips metadata from uploads and converts some formats. It does not keep a separate copy of the original file by default.

Enable **Keep original file** under Settings → Preferences to preserve future uploads exactly as submitted. The setting saves immediately.

Original files retain EXIF metadata, including location data. Check for sensitive information before sharing them.

### What is QOI?

[QOI](https://qoiformat.org/) is a lossless image format designed for fast encoding and decoding. Picsur stores uploads such as TIFF, HEIC, and TGA as QOI. JPEG, PNG, APNG, WebP, and GIF keep their original format, with metadata removed.

### I get "Copying to clipboard failed"

Clipboard access requires HTTPS or localhost. Configure HTTPS for your instance.

## Development

Install Node.js 24 (see `.nvmrc`) and Docker, then enable pnpm through Corepack and prepare the project:

```sh
corepack enable
pnpm install
pnpm devdb:start

pnpm --filter picsur-shared build
```

Run the frontend and backend watchers in separate terminals:

```sh
# Terminal 1: rebuild the frontend on changes
pnpm --filter picsur-frontend watch
```

```sh
# Terminal 2: serve the API and frontend on http://localhost:8080
pnpm --filter picsur-backend start:dev
```

Tests, with the development database running:

```sh
pnpm --filter picsur-backend build
pnpm --filter picsur-backend test:unit
pnpm --filter picsur-backend test:e2e
```

End-to-end tests start the built backend with a temporary database. They can also test object storage or a Docker image; see [`global-setup.ts`](backend/test/e2e/global-setup.ts) for options. Build the image with `docker build -t picsur .`.

## API

Open `/api/openapi.json` in Swagger UI or Postman for the API reference. It is generated from the running server’s request and response schemas and lists the permissions each route requires. Anonymous requests use the guest role’s permissions.

Authenticate with either:

- `Authorization: Bearer <token>`, using a token from `/api/user/login`.
- `Authorization: Api-Key <key>`, using a key from Settings → API keys.

Upload responses include links to the image. Schema definitions are in `shared`. The original project’s [Postman reference](https://www.postman.com/caramel-team/workspace/picsur/collection/1841871-78e559b6-4f39-4092-87c3-92fa29547d03) covers the older API.

## Credits

Picsur was created by [Caramel](https://github.com/CaramelFur). This fork would not exist without the years of work that went into the original.

Thanks from the original project to everyone who supported it:

- @aldumil for once donating $5
- @mcmastererp for monthly donating $2 from March 2024 to October 2024
- @gander for monthly donating $5 from March 2024 to November 2024
- @TheSameCat2 for monthly donating $5 from November 2023 to May 2024
- @LordCrashWire for once donating $20
- @chennin for monthly donating $4 from June 2023 to September 2024
- @awg13 for once donating $10

## License

[GNU Affero General Public License v3.0](LICENSE)
