<img align="left" width="100" height="100" style="border-radius: 15%" src="branding/logo/picsur.svg"/>

# Picsur

> Totally not an Imgur clone

A self-hostable image sharing service, a hybrid between Imgur and Pastebin.

This is **nPicsur**, a maintained fork of [Picsur](https://github.com/CaramelFur/Picsur) by Caramel, who is no longer working on it. It picks up where the original left off: S3 compatible storage, security fixes, current versions of Node.js and its dependencies, and a tested Docker image.

## What changed in this fork

- **S3 compatible object storage** for image data, as an alternative to the database. It can be set up on the settings page, and existing images can be moved in either direction from there, see [Storing images in S3](#storing-images-in-s3).
- **Security fixes**, among others:
  - Users allowed to manage users, roles or api keys could make themselves administrator. They can now only hand out permissions they have themselves.
  - Rate limiting did not work, and anonymous visitors could make the server convert images without limit.
  - Changing a password now logs that user out everywhere.
  - Deletion links ask for confirmation, so link previews in chat apps no longer delete images.
  - Without `PICSUR_ADMIN_PASSWORD`, new instances got the admin password `picsur`. A random password is now generated instead.
  - Api keys are stored hashed and only shown once, when they are created. They can no longer be turned into login tokens.
- **New features**: albums, a public gallery, a light theme, changing your own password, and a settings page for the server itself, which restarts Picsur to apply them.
- **Telemetry removed**: every instance of the original reported its hostname, user and image counts to the original author's server every hour.
- **Current versions**: Node.js 24, NestJS 11 and Fastify 5 for the server, Angular 22 for the frontend. No dependency has a known vulnerability.
- **Docker image** for amd64 and arm64 with HEIC (iPhone photos), JPEG XL and JPEG 2000 support. It is tested in CI before it is published.
- An end-to-end test suite, run in CI against both storage drivers and against the Docker image.

## Features

- Uploading and viewing images, anonymously or with an account
- User accounts, with roles and permissions
- Many formats: QOI, JPEG, PNG, WebP (animated), GIF (animated), TIFF, AVIF, HEIF/HEIC, BMP, JPEG XL, JPEG 2000
- Converting and editing images through the url: resize, rotate, flip, strip transparency, negative, greyscale
- EXIF stripping, with the option to keep the original file
- Expiring images, and deleting images with a secret deletion link
- Correct previews in chat apps
- A ShareX configuration builder, and api keys
- Images stored in the database or in S3 compatible object storage
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

| Variable                            | Default                    | Description                                                                                                                                                     |
| ----------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PICSUR_DB_HOST`                    | `localhost`                | Postgres server                                                                                                                                                 |
| `PICSUR_DB_PORT`                    | `5432`                     |                                                                                                                                                                 |
| `PICSUR_DB_USERNAME`                | `picsur`                   |                                                                                                                                                                 |
| `PICSUR_DB_PASSWORD`                | `picsur`                   |                                                                                                                                                                 |
| `PICSUR_DB_DATABASE`                | `picsur`                   |                                                                                                                                                                 |
| `PICSUR_ADMIN_PASSWORD`             | random, printed in the log | Password of the `admin` account when it is first created. Change it later in the settings                                                                       |
| `PICSUR_JWT_SECRET`                 | random, stored in the db   | Secret for signing login tokens                                                                                                                                 |
| `PICSUR_JWT_EXPIRY`                 | `7d`                       | How long a login lasts                                                                                                                                          |
| `PICSUR_ENCRYPTION_KEY`             |                            | Encrypts secrets saved on the settings page, see below. Any long random value, like the output of `openssl rand -base64 32`                                     |
| `PICSUR_MAX_FILE_SIZE`              | `128000000`                | Largest accepted upload, in bytes                                                                                                                               |
| `PICSUR_TRUST_PROXY`                | private addresses          | Which proxies may pass on the visitor's address (`X-Forwarded-For`), used for rate limiting. `true`, `false`, or a comma separated list of addresses and ranges |
| `PICSUR_MAX_CONCURRENT_CONVERSIONS` | number of CPUs             | How many images are converted at once, more wait in line                                                                                                        |
| `PICSUR_CONVERSION_RATE_LIMIT`      | `120`                      | New conversions a single visitor may start per minute, `0` for no limit                                                                                         |
| `PICSUR_STORAGE_DRIVER`             | `database`                 | Where new images are stored, `database` or `s3`                                                                                                                 |
| `PICSUR_S3_*`                       |                            | See [Storing images in S3](#storing-images-in-s3)                                                                                                               |
| `PICSUR_HOST` / `PICSUR_PORT`       | `0.0.0.0` / `8080`         | Where the server listens                                                                                                                                        |
| `PICSUR_STATIC_FRONTEND_ROOT`       | the built in frontend      | Only needed for a custom frontend                                                                                                                               |
| `PICSUR_VERBOSE`                    | `false`                    | More logging, which might include sensitive data                                                                                                                |

The storage, the upload size, the conversion limits and the trusted proxies can also be set in the web interface, under Settings → Server. Picsur restarts itself to apply them, and goes back to the settings it had before when it can not start with the new ones. An environment variable takes precedence over what is set there, the page shows such settings but can not change them.

Values of these environment variables are saved in the settings as well, every time Picsur starts. So to manage a setting on the page instead, remove its variable and restart the container: Picsur keeps using the last value, which can then be changed on the page. The page lists the variables that can be removed.

Secrets, like the S3 secret access key, are only saved encrypted with `PICSUR_ENCRYPTION_KEY`. That key is not stored in the database, so neither the database nor its backups reveal the secrets. Without it, secrets can only be set with their environment variables. Keep the key safe and do not change it: secrets saved with it can not be read without it, and have to be entered again.

Everything else is set in the web interface, under settings.

## Storing images in S3

Image data can be stored in any S3 compatible object storage instead of the database, like AWS S3, Garage, MinIO or RustFS. The database still holds everything else.

The easiest way to set it up is on the settings page, under Settings → Server:

1. Choose to store new images in S3 compatible object storage, and fill in where the bucket is. For MinIO and most other self hosted services, turn on path style addressing.
2. Test the storage, which also creates the bucket when it does not exist yet.
3. Save, and restart Picsur when asked. It offers to move the images stored so far into the bucket after restarting. Picsur keeps working while they are moved, and the page shows how far along it is.

Moving back to the database works the same way. A bucket can only be changed or removed once no images are stored in it anymore, so they do not become unreachable.

Saving the secret access key on the page needs `PICSUR_ENCRYPTION_KEY`, see [Configuration](#configuration).

Everything can also be set with environment variables, which then can not be changed on the page until they are removed:

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

# Delete objects in the bucket that no image uses anymore, for example after
# the bucket could not be reached while images were deleted
docker exec picsur node backend/dist/cli.js storage gc --dry-run
docker exec picsur node backend/dist/cli.js storage gc
```

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
- There is a public gallery, which only shows the images their owners chose to show there, so it starts out empty. The guest and user roles get the new "View Gallery" permission for it.
- The token from `/api/user/me` is empty when authenticated with an api key. Api keys are used directly instead.
- Api keys are only shown once, when they are created. Existing keys keep working, also in ShareX configs. The ShareX config builder creates a new key for every config.
- The image metadata (`/i/meta/:id`) only shows the uploader's id and username.
- The statistics proxy (`/api/usage/report`) only accepts JSON.

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

Open the image, edit it, and turn on "Show in the public gallery". Everyone with the "View Gallery" permission can then find it in the gallery, by default that includes visitors who are not logged in. Other images can only be seen by whoever has their link.

To close the gallery to visitors, go to `settings -> roles -> guest -> edit` and remove the "View Gallery" permission. Remove it from the user role as well to turn the gallery off completely.

### I want to keep my original image files, how?

By default, Picsur will not keep your original image files. Since for most purposes this is not needed, and it saves disk space.

If you want to enable this however, you can do so by going to `settings -> general`, and then enabling the `Keep original` option. Upon saving the settings, the original files will be kept.

Do keep in mind here, that the exif data will NOT be removed from the original image. So make sure you do not accidentally share sensitive data.

### This service says its supports the QOI format, what is this?

QOI is a lossless image format that is designed to be very fast to encode and decode, while still offering good compression ratios. This is the primary format the server stores images in when uploaded.

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
