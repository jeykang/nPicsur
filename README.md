<img align="left" width="100" height="100" style="border-radius: 15%" src="branding/logo/picsur.svg"/>

# Picsur

> Totally not an Imgur clone

A self-hostable image sharing service, a hybrid between Imgur and Pastebin.

This is **nPicsur**, a maintained fork of [Picsur](https://github.com/CaramelFur/Picsur) by Caramel, who is no longer working on it. It picks up where the original left off: S3 compatible storage, security fixes, current versions of Node.js and its dependencies, and a tested Docker image.

## What changed in this fork

- **S3 compatible object storage and directories on disk** for image data, as alternatives to the database. They can be set up on the settings page, and existing images can be moved between them from there, see [Storing images on disk](#storing-images-on-disk) and [Storing images in S3](#storing-images-in-s3).
- **Security fixes**, among others:
  - Users allowed to manage users, roles or API keys could make themselves administrator. They can now only hand out permissions they have themselves.
  - Rate limiting did not work, and anonymous visitors could make the server convert images without limit.
  - Changing a password now logs that user out everywhere.
  - Deletion links ask for confirmation, so link previews in chat apps no longer delete images.
  - Without `PICSUR_ADMIN_PASSWORD`, new instances got the admin password `picsur`. A random password is now generated instead.
  - API keys are stored hashed and only shown once, when they are created. They can no longer be turned into login tokens.
- **New features**: albums, a public gallery, a light theme, changing your own password, logging in with an OpenID Connect provider like Authelia, and a settings page for the server itself, which restarts Picsur to apply them.
- **Telemetry removed**: every instance of the original reported its hostname, user and image counts to the original author's server every hour.
- **Current versions**: Node.js 24, NestJS 11 and Fastify 5 for the server, Angular 22 for the frontend. No dependency has a known vulnerability.
- **Docker image** for amd64 and arm64 with HEIC (iPhone photos), JPEG XL and JPEG 2000 support. It is tested in CI before it is published.
- An end-to-end test suite, run in CI with images in the database, in S3 and on disk, and against the Docker image.

## Features

- Uploading and viewing images, anonymously or with an account
- User accounts, with roles and permissions
- Logging in with an OpenID Connect provider, like Authelia, Authentik or Keycloak, next to passwords or instead of them
- Many formats: QOI, JPEG, PNG, APNG (animated), WebP (animated), GIF (animated), TIFF, AVIF, HEIF/HEIC, BMP, ICO, TGA, JPEG XL, JPEG 2000
- Converting and customizing images through the URL: resize, rotate, flip, strip transparency, negative, greyscale
- EXIF stripping, with the option to keep the original file
- Expiring images, and deleting images with a secret deletion link
- Correct previews in chat apps
- A ShareX configuration builder, and API keys
- Images stored in the database, in S3 compatible object storage, or in a directory on disk
- Albums, which anyone with their link can see
- A public gallery of the images their owners chose to show there
- A dark and a light theme

## Running your own instance

Picsur runs in Docker, next to a Postgres database. An example `docker-compose.yml`, see [`support/picsur.docker-compose.yml`](support/picsur.docker-compose.yml) for every option:

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

Then open <http://localhost:8080> and log in as `admin`. Without `PICSUR_ADMIN_PASSWORD`, a random password is generated the first time Picsur starts, it is printed in the log:

```sh
docker logs picsur 2>&1 | grep -i password
```

Put Picsur behind a reverse proxy with HTTPS, the clipboard buttons only work on HTTPS.

The `latest` tag is the latest release, `edge` follows the master branch.

### Configuration

These are only set with environment variables, as Picsur needs them before it can read its settings, or as they are secrets kept out of the database:

| Variable                      | Default                             | Description                                                                                                                                       |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PICSUR_DB_HOST`              | `localhost`                         | Postgres server                                                                                                                                   |
| `PICSUR_DB_PORT`              | `5432`                              |                                                                                                                                                   |
| `PICSUR_DB_USERNAME`          | `picsur`                            |                                                                                                                                                   |
| `PICSUR_DB_PASSWORD`          | `picsur`                            |                                                                                                                                                   |
| `PICSUR_DB_DATABASE`          | `picsur`                            |                                                                                                                                                   |
| `PICSUR_ADMIN_PASSWORD`       | random, printed in the log          | Password of the `admin` account when it is first created. Change it later in the settings                                                         |
| `PICSUR_JWT_SECRET`           | generated, stored in the db         | Secret for signing login tokens, whoever knows it can log in as anyone                                                                            |
| `PICSUR_ENCRYPTION_KEY`       | generated, stored in the db         | Encrypts secrets saved on the settings page. Set it to protect them from copies of the database as well, see below                                |
| `PICSUR_HOST` / `PICSUR_PORT` | `0.0.0.0` / `8080`                  | Where the server listens                                                                                                                          |
| `PICSUR_STATIC_FRONTEND_ROOT` | the built in frontend               | Only needed for a custom frontend                                                                                                                 |
| `PICSUR_PRODUCTION`           | `false`, `true` in the Docker image | Leave it out only for development, where the database tables are changed to match the code, and everything is logged                              |
| `PICSUR_DEMO`                 | `false`                             | Demo mode: guests can upload, and all images are deleted every `PICSUR_DEMO_INTERVAL` milliseconds. The guest role keeps the permission to upload |
| `PICSUR_DEMO_INTERVAL`        | `300000`, 5 minutes                 |                                                                                                                                                   |

Everything else is set on the settings page, under Settings → Server, or with these environment variables:

| Variable                            | Default                             | Description                                                                                                                                                                                                                                        |
| ----------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PICSUR_STORAGE_DRIVER`             | `database`                          | Where new images are stored, `database`, `s3` or `filesystem`                                                                                                                                                                                      |
| `PICSUR_STORAGE_PATH`               |                                     | See [Storing images on disk](#storing-images-on-disk)                                                                                                                                                                                              |
| `PICSUR_S3_*`                       |                                     | See [Storing images in S3](#storing-images-in-s3)                                                                                                                                                                                                  |
| `PICSUR_MAX_FILE_SIZE`              | `128000000`                         | Largest accepted upload, in bytes                                                                                                                                                                                                                  |
| `PICSUR_GUEST_UPLOAD_EXPIRY`        | `0`                                 | How long uploads of visitors who are not logged in are kept at most, like `1d`. `0` keeps them                                                                                                                                                     |
| `PICSUR_MAX_CONCURRENT_CONVERSIONS` | number of CPUs                      | How many images are converted at once, more wait in line                                                                                                                                                                                           |
| `PICSUR_CONVERSION_RATE_LIMIT`      | `120`                               | New conversions a single visitor may start per minute, `0` for no limit                                                                                                                                                                            |
| `PICSUR_CONVERSION_TIME_LIMIT`      | `15s`                               | How long converting one image may take, at most `10m`                                                                                                                                                                                              |
| `PICSUR_CONVERSION_MEMORY_LIMIT`    | `512`                               | How much memory converting one image may use, in MB                                                                                                                                                                                                |
| `PICSUR_ALLOW_EDITING`              | `true`                              | Whether the address of an image can ask for another size, a rotation or other changes. Other formats can always be asked for                                                                                                                       |
| `PICSUR_REMOVE_DERIVATIVES_AFTER`   | `7d`                                | Converted versions not asked for this long are removed, and made again when needed. `0` keeps them                                                                                                                                                 |
| `PICSUR_TRUST_PROXY`                | loopback and private IPv4 addresses | Which proxies may pass on the visitor's address (`X-Forwarded-For`), used for rate limiting. `true`, `false`, or a comma separated list of addresses, ranges, and the names `loopback`, `linklocal` and `uniquelocal`, which include the IPv6 ones |
| `PICSUR_HOST_OVERRIDE`              | the browser's                       | The address Picsur is reached at, like `https://images.example.com`, for links to images and logging in with a provider                                                                                                                            |
| `PICSUR_OIDC_*`                     |                                     | See [Logging in with OpenID Connect](#logging-in-with-openid-connect)                                                                                                                                                                              |
| `PICSUR_PASSWORD_LOGIN`             | `true`                              | Whether users can log in with a password, see [Logging in with OpenID Connect](#logging-in-with-openid-connect)                                                                                                                                    |
| `PICSUR_JWT_EXPIRY`                 | `7d`                                | How long someone stays logged in without opening Picsur                                                                                                                                                                                            |
| `PICSUR_BCRYPT_STRENGTH`            | `10`                                | How hard passwords are to find from a copy of the database, from 4 to 15. Every step doubles the time logging in takes                                                                                                                             |
| `PICSUR_TRACKING_URL`               |                                     | An [Ackee](https://github.com/electerious/Ackee) server to count visits with, visits are passed on through Picsur                                                                                                                                  |
| `PICSUR_TRACKING_ID`                |                                     | The id of Picsur as a website in Ackee, visits are counted once both are set                                                                                                                                                                       |
| `PICSUR_VERBOSE`                    | `false`                             | More logging, which might include sensitive data                                                                                                                                                                                                   |

Durations are written like `15s`, `30m`, `12h` or `7d`, and true or false as `true` and `false`, or `yes`, `no`, `1` and `0` in the environment. Environment variables can also be put in a `.env` file in the directory Picsur is started from, the environment comes before it.

The processes that convert images get none of these variables, as they handle untrusted files. They only get those for libvips and sharp, which start with `VIPS_` or `SHARP_`, like `VIPS_CONCURRENCY`.

What is saved on the settings page comes before these environment variables, which only set what is not saved there. So the variables can be what an instance starts out with, to be changed on the page later. The page lists the variables that are not used because something is saved instead, and can go back to them. It also shows what is only set with environment variables.

`PICSUR_CONVERSION_TIME_LIMIT`, `PICSUR_CONVERSION_MEMORY_LIMIT`, `PICSUR_ALLOW_EDITING`, `PICSUR_REMOVE_DERIVATIVES_AFTER`, `PICSUR_GUEST_UPLOAD_EXPIRY`, `PICSUR_HOST_OVERRIDE`, `PICSUR_JWT_EXPIRY`, `PICSUR_BCRYPT_STRENGTH` and `PICSUR_TRACKING_*` take effect as soon as they are saved on the page. The others when Picsur restarts, which it does itself from the settings page. When it cannot start with the new settings, it goes back to the ones it had before.

The command line tool shows where each of these settings comes from, and removes what is saved for a setting, so its variable or default applies again once Picsur restarts:

```sh
docker exec picsur node backend/dist/cli.js settings list
docker exec picsur node backend/dist/cli.js settings reset max_file_size
```

Secrets saved on the settings page, like the S3 secret access key, are always encrypted. By default Picsur generates the key for that and keeps it in the database, which keeps the secrets out of sight, but someone with a copy of the database can still decrypt them. To prevent that, set `PICSUR_ENCRYPTION_KEY` to a long random value, like the output of `openssl rand -base64 32`. It is not stored anywhere, and secrets saved with the generated key are encrypted with it the next time Picsur starts, after which the generated key is removed. Keep it safe along with your backups: secrets saved with it cannot be read without it, and would have to be entered again.

Encrypted secrets are stored as `enc:v1:env:...` or `enc:v1:db:...`, [`settings-encryption.ts`](backend/src/config/settings-encryption.ts) describes the format, for decrypting them by hand.

## Storing images on disk

Image data can also be stored as files in a directory, instead of in the database. The database still holds everything else, and which file belongs to which image. Backing up the images is then a matter of copying the directory, next to a backup of the database.

In Docker, mount a volume for the images. The image has a directory ready for that, `/picsur/images`:

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

A directory on the host works as well, like `./images:/picsur/images`, as long as Picsur may write to it: it runs as user 1000, so `sudo chown 1000:1000 images` does it.

Then choose to store new images in a directory on disk under Settings → Server, with `/picsur/images` as the directory. Testing it tells whether Picsur can store images there, and warns when the directory is not on a volume, which would lose the images when the container is replaced. After saving and restarting, the images stored so far can be moved there, like with a bucket. The same can be set with environment variables:

| Variable                | Description                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| `PICSUR_STORAGE_DRIVER` | `filesystem` to store new images in the directory                   |
| `PICSUR_STORAGE_PATH`   | The directory, a full path. It is created if it does not exist yet. |

Every file is written under another name first, and only gets its name once it is completely on disk, so an image is never cut short when Picsur or the server stops halfway. Files are laid out like in a bucket, `images/<image id>/master`, with converted versions under `images/<image id>/derivatives/`.

Like a bucket, the directory can only be changed once no images are stored in it anymore. To move the files somewhere else yourself, stop Picsur, move them, and change `PICSUR_STORAGE_PATH`.

## Storing images in S3

Image data can be stored in any S3 compatible object storage instead of the database, like AWS S3, Garage, MinIO or RustFS. The database still holds everything else.

The easiest way to set it up is on the settings page, under Settings → Server:

1. Choose to store new images in S3 compatible object storage, and fill in where the bucket is. For MinIO and most other self hosted services, turn on path style addressing.
2. Test the storage, which also creates the bucket when it does not exist yet.
3. Save, and restart Picsur when asked. It offers to move the images stored so far into the bucket after restarting. Picsur keeps working while they are moved, and the page shows how far along it is.

Moving back to the database, or to a directory, works the same way. A bucket can only be changed or removed once no images are stored in it anymore, so they do not become unreachable.

The secret access key is saved encrypted, see [Configuration](#configuration) for how to keep it safe from copies of the database as well.

Everything can also be set with environment variables, which apply when nothing is saved on the page:

| Variable                      | Description                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `PICSUR_STORAGE_DRIVER`       | `s3` to store new images in the bucket                                                         |
| `PICSUR_S3_BUCKET`            | The bucket, it is created if it does not exist                                                 |
| `PICSUR_S3_REGION`            | Defaults to `us-east-1`                                                                        |
| `PICSUR_S3_ENDPOINT`          | For services other than AWS itself, like `https://s3.example.com`                              |
| `PICSUR_S3_FORCE_PATH_STYLE`  | `true` for services that need `https://host/bucket` style urls, which most self hosted ones do |
| `PICSUR_S3_ACCESS_KEY_ID`     | Credentials, if not given the usual AWS environment variables and files are used               |
| `PICSUR_S3_SECRET_ACCESS_KEY` |                                                                                                |
| `PICSUR_S3_PREFIX`            | Keep Picsur's objects under this path in the bucket, like `picsur/`                            |

Images already in the database stay readable after switching to `s3`, and images in the bucket stay readable after switching back, as long as the bucket is configured. Existing images can be moved over on the settings page, or with the command line tool, which uses the same settings:

```sh
# Where image data is stored right now
docker exec picsur node backend/dist/cli.js storage status

# Move everything to where new images are stored. Can run while Picsur is
# running, and can be run again if it was interrupted.
docker exec picsur node backend/dist/cli.js storage migrate

# Delete files in the bucket or the directory that no image uses anymore, for
# example after the bucket could not be reached while images were deleted.
# Files younger than an hour are left alone, as they might belong to an
# upload in progress, --min-age <seconds> changes that.
docker exec picsur node backend/dist/cli.js storage gc --dry-run
docker exec picsur node backend/dist/cli.js storage gc
```

## Logging in with OpenID Connect

Users can log in with an OpenID Connect provider, like Authelia, Authentik, Keycloak, Pocket ID or Google, next to their password or instead of it. Picsur follows the standard, with [openid-client](https://github.com/panva/openid-client), so any provider that does should work.

### At the provider

Create a client for Picsur: a confidential client, also called a web application, that uses the authorization code flow. Give it these settings:

- **Redirect URI**: `https://picsur.example.com/user/oidc`, with the address you open Picsur at. The settings page shows the exact address. Register exactly that one, not a pattern with wildcards. When a public address is set under Settings → Server, it is used for this address.
- **Scopes**: `openid profile email`.
- **PKCE**: Picsur always uses it, with `S256`, so it can be required.
- **Client authentication**: `client_secret_basic`. Picsur only sends the secret in the request body instead (`client_secret_post`) to providers that do not support the former.

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

`authelia crypto hash generate pbkdf2 --variant sha512 --random --random.length 72 --random.charset rfc3986` makes a random secret for Picsur and its digest for Authelia, see [Authelia's documentation](https://www.authelia.com/integration/openid-connect/frequently-asked-questions/#client-secret).

### In Picsur

Under Settings → Server → Logging in, enter the issuer of the provider (like `https://auth.example.com`), the client id and secret, and the name of the provider for the login button. Testing it tells whether Picsur can reach the provider. After saving and restarting, the login page has a button to log in with the provider.

Users with an account here link their account at the provider under Settings → Account, after which they can log in with it. Accounts are linked by the id the provider gives them, never by username or email address, so a user of the provider named like an account here cannot take it over. An account at the provider is linked to one account here, and the other way around.

Without an account, logging in at the provider does not get you in, unless **Create accounts for new users** is on. Then everyone who can log in at the provider gets an account the first time, with the default roles. Only turn that on when the provider only lets in people who should have an account. In Authelia, that takes an authorization policy for the client, as its access control rules do not apply to OpenID Connect clients ([why](https://www.authelia.com/integration/openid-connect/frequently-asked-questions/#why-doesnt-the-access-control-configuration-work-with-openid-connect-10)). This one only lets in the users in the `picsur` group:

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

New accounts are named after the `preferred_username` claim, or another one that is set, without characters other than letters and digits, and with a number after it when that name is taken. They have no password, users can set one under Settings → Account.

Once your own account is linked, **Password login** can be turned off, so only logging in at the provider works, and nobody can register with a password. Should the provider be unreachable then, remove that setting on the command line and restart Picsur to turn password login on again, or remove `PICSUR_PASSWORD_LOGIN` when it was turned off with that:

```sh
docker exec picsur node backend/dist/cli.js settings reset password_login
docker restart picsur
```

With **Go to the provider right away**, the login page goes straight to the provider, `/user/login?local` still shows it.

The same can be set with environment variables:

| Variable                     | Description                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `PICSUR_OIDC_ISSUER`         | The issuer of the provider, or the address of its discovery document                  |
| `PICSUR_OIDC_CLIENT_ID`      |                                                                                       |
| `PICSUR_OIDC_CLIENT_SECRET`  |                                                                                       |
| `PICSUR_OIDC_NAME`           | Of the provider, the login button says "Log in with" it. Defaults to `single sign-on` |
| `PICSUR_OIDC_SCOPE`          | Defaults to `openid profile email`                                                    |
| `PICSUR_OIDC_USERNAME_CLAIM` | The claim new accounts are named after, defaults to `preferred_username`              |
| `PICSUR_OIDC_AUTO_REGISTER`  | `true` to create accounts for new users                                               |
| `PICSUR_OIDC_AUTO_LAUNCH`    | `true` to go to the provider right away                                               |
| `PICSUR_PASSWORD_LOGIN`      | `false` to turn off password login, which only works with a provider set up           |

Linked accounts belong to the provider they were linked at. While password login is off, the provider cannot be changed, as nobody could log in with the new one yet, and accounts cannot be unlinked, as that would leave their users no way to log in.

## Upgrading from Picsur 0.5

1. Back up the database, for example with `docker exec picsur_postgres pg_dump -U picsur picsur > picsur.sql`.
2. Change the image to `ghcr.io/jeykang/npicsur:latest`, and start it. The database is upgraded automatically.
3. Accounts and passwords stay as they are. If the admin password is still the old default `picsur`, Picsur warns about it in the log: change it in the settings.

Things that behave differently:

- Deleting a user deletes their images as well. Picsur 0.5 kept them, to delete the images of users you deleted before:

  ```sh
  docker exec picsur node backend/dist/cli.js images delete-orphaned --dry-run
  docker exec picsur node backend/dist/cli.js images delete-orphaned
  ```

- Deletion links open a page that asks for confirmation. Links saved by ShareX keep working.
- There is a public gallery, which only shows the images their owners chose to show there, so it starts out empty. The guest and user roles get the new "View the gallery" permission for it.
- The token from `/api/user/me` is empty when authenticated with an API key. API keys are used directly instead.
- API keys are only shown once, when they are created. Existing keys keep working, also in ShareX configs. The ShareX config builder creates a new key for every config.
- The image metadata (`/i/meta/:id`) only shows the uploader's id and username.
- The statistics proxy (`/api/usage/report`) only accepts JSON.
- The system settings are under Settings → Server, with the other settings of the server, and what was set there is moved over. Each can be set with an environment variable as well, see [Configuration](#configuration). What is saved on that page comes before environment variables, also before `PICSUR_JWT_EXPIRY`, which used to come first.
- Visits are only counted with Ackee when both its address and the website id are set, the setting to turn it on is gone.

## Upgrading Postgres

Postgres 14 [stops getting fixes](https://www.postgresql.org/support/versioning/) on 12 November 2026. A new major version of Postgres can't use the data of an older one, so the database has to be copied over ([Postgres documentation](https://www.postgresql.org/docs/current/upgrading.html)). With images in S3 this is quick, the images themselves stay in the bucket.

1. Stop Picsur and export the database:

   ```sh
   docker compose stop picsur
   docker exec picsur_postgres pg_dump -U picsur picsur > picsur.sql
   ```

2. Change the Postgres image to `postgres:17-alpine`, and give it a new volume, like `picsur-data17:/var/lib/postgresql/data` (also add it under `volumes:`). Keep `POSTGRES_PASSWORD` as it is, and the old volume until everything works.
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

By default, users can't register their own accounts. This is to prevent users from accidentally allowing anyone to upload to their instance.

If you want to allow this you can though. To change this you go to `settings -> roles -> guest -> edit`, and then give the guest role the `Register` permission. Upon saving the role, the register button will appear on the login page.

### How do I show images in the gallery, or close it?

Open the image, edit it, and turn on "Show in the public gallery". Everyone with the "View the gallery" permission can then find it in the gallery, by default that includes visitors who are not logged in. Other images can only be seen by whoever has their link.

To close the gallery to visitors, go to `settings -> roles -> guest -> edit` and remove the "View the gallery" permission. Remove it from the user role as well to turn the gallery off completely.

### How do I make images expire by themselves?

Under `settings -> preferences`, "New images expire after" sets when what you upload from then on expires. Each image can still be given another time when editing it. The ShareX config can ask for a time of its own, when exporting it under `settings -> sharex`, and so can any upload through the api, with `/api/image/upload?expires_after=<seconds>`, `0` for never.

When visitors who are not logged in may upload, "Guest uploads expire after" under `settings -> server` keeps their images that long at most.

### I want to keep my original image files, how?

By default, Picsur will not keep your original image files. Since for most purposes this is not needed, and it saves disk space.

If you want to enable this however, you can do so by going to `settings -> preferences`, and then turning on "Keep original file". It is saved right away, and applies to the images you upload from then on.

Do keep in mind here, that the exif data will NOT be removed from the original image. So make sure you do not accidentally share sensitive data.

### This service says its supports the QOI format, what is this?

QOI is a lossless image format that is designed to be very fast to encode and decode, while still offering good compression ratios. Uploads in formats Picsur cannot keep as they are, like TIFF, HEIC or TGA, are stored as QOI. JPEG, PNG, APNG, WebP and GIF uploads are kept as they were uploaded, only without their metadata.

You can [read more about QOI here](https://qoiformat.org/).

### I get "Copying to clipboard failed"

It is only possible to use the clipboard functionality on HTTPS websites or localhost. Please ensure you are running Picsur with HTTPS.

## Development

You need Node.js 24 (see `.nvmrc`), Docker for the development database, and pnpm through corepack:

```sh
corepack enable
pnpm install
pnpm devdb:start

pnpm --filter picsur-shared build
# Rebuilds the frontend on changes
pnpm --filter picsur-frontend watch
# Serves the api and the frontend on http://localhost:8080
pnpm --filter picsur-backend start:dev
```

Tests, with the development database running:

```sh
pnpm --filter picsur-backend build
pnpm --filter picsur-backend test:unit
pnpm --filter picsur-backend test:e2e
```

The end-to-end tests start the built backend against a fresh database, and can also test object storage or a Docker image, see the top of [`backend/test/e2e/global-setup.ts`](backend/test/e2e/global-setup.ts). Build the image with `docker build -t picsur .`.

## Api

The original project documented its api [on Postman](https://www.postman.com/caramel-team/workspace/picsur/collection/1841871-78e559b6-4f39-4092-87c3-92fa29547d03). The `shared` folder contains the exact schemas of every request and response.

## Credits

Picsur was created by [Caramel](https://github.com/CaramelFur). This fork would not exist without the years of work that went into the original.

Thanks from the original project to everyone who supported it:

- @aldumil for once donating $5
- @mcmastererp for monthly donating $2 from March 2024 to Oktober 2024
- @gander for monthly donating $5 from March 2024 to November 2024
- @TheSameCat2 for monthly donating $5 from November 2023 to May 2024
- @LordCrashWire for once donating $20
- @chennin for monthly donating $4 from June 2023 to September 2024
- @awg13 for once donating $10

## License

[GNU Affero General Public License v3.0](LICENSE)
