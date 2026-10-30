# Changelog

## Unreleased

### New

- Serve Picsur under a path, such as `https://example.com/picsur/`, by setting `PICSUR_BASE_PATH`. The reverse proxy can pass the path on or remove it. See [Serving Picsur under a path](README.md#serving-picsur-under-a-path).

### Fixed

- Public addresses ending in `/` no longer produce broken image and album links in the frontend.

## 0.7.2

### Lighter

- The Docker image is about 26 MB smaller, as it no longer includes TypeScript and ts-node, which nothing used.

### Changed

- Simplified UI text, setup instructions, and documentation.

### Security

- Limited validation errors for large lists, such as bulk image deletions, to prevent excessive memory use.
- Updated the Docker image to Node.js 24.22.1 (a security release) and libvips 8.18.7, which adds stricter TIFF, JPEG 2000, and EXIF validation.

## 0.7.1

### New

- Search My Images by name and filter by format, album, or upload date. Filters persist in the URL and are also supported by `/api/image/list`.
- Select multiple images in My Images to delete them or add them to an album.
- Upload responses include links to the image page, a browser-compatible image, and a deletion page when a delete key exists. Links use the configured public address, if set.
- Added an [OpenAPI reference](README.md#api) at `/api/openapi.json`, generated from the running server’s request and response schemas.
- Set a default upload expiry under Settings → Preferences, in a ShareX config, or per request with `?expires_after=<seconds>`. Limit anonymous upload lifetimes with `PICSUR_GUEST_UPLOAD_EXPIRY` or Settings → Server. See [image expiry](README.md#how-do-i-make-images-expire-by-themselves).

### Faster

- Images include `ETag` and `Last-Modified` headers. Conditional requests return 304 when unchanged, avoiding image reads and downloads.

### Lighter

- Stream images from S3 and disk instead of buffering entire files. With 64 clients downloading 4.6 MB photos at about 2 MB/s each, memory use fell from 430 MB to 245 MB for disk storage and from 515 MB to 250 MB for S3. Tests used the Docker startup settings. With unrestricted local clients, memory use fell about 10%; S3 downloads were 16% faster and disk downloads 12% slower.
- Removed the 50-connection limit for S3. Slow downloads no longer exhaust the connection pool and block other requests.

### Fixed

- Cached images now expire by their scheduled expiry time, instead of remaining cached for up to a month.
- HEAD requests for missing images, such as `/i/<id>.png`, now return a not-found response.
- Unknown URLs now show the not-found page. Failed page loads, including after an update, no longer leave the loading bar running.

## 0.7.0

### New

- Added Settings → Server for storage, upload limits, conversion limits, and trusted proxies. It can test storage connections and restart Picsur to apply changes. Failed restarts restore the previous settings. Saved values override environment variables; the page lists overrides and lets you restore environment values.
- Added `node dist/cli.js settings list` to show setting sources and `settings reset <setting>` to restore an environment value or default.
- Saved secrets are encrypted with a generated database key. Set `PICSUR_ENCRYPTION_KEY` to keep the key separate from the database. Existing secrets are re-encrypted on startup.
- Move images between database and S3 storage from the settings page, with progress reporting and no downtime.
- The CLI now respects saved server settings.
- Added APNG, ICO, and TGA uploads and conversions. PNG, GIF, and WebP conversions preserve animation. APNG uploads keep their original format. Icons use the largest embedded image and export at up to 256 pixels. TGA decoding supports all variants, including run-length encoding and color maps.
- Added [OpenID Connect login](README.md#logging-in-with-openid-connect), configured through Settings → Server or `PICSUR_OIDC_*`. Users can link existing accounts or register automatically if enabled. Admins can disable password login after linking their own account and restore it with `node dist/cli.js settings reset password_login`.
- Added filesystem storage through Settings → Server or `PICSUR_STORAGE_DRIVER=filesystem` and `PICSUR_STORAGE_PATH`. The Docker image includes `/picsur/images` for a volume; the settings page warns if storage is outside a volume. Migration supports all three storage types; `storage gc` also cleans up filesystem storage.

### Faster

- JPEG, PNG, WebP, and GIF uploads now retain their format with metadata removed. Other formats still use QOI; existing images are unchanged. For a 12 MP JPEG, this avoids a 9-fold size increase, makes uploads about 9 times faster, and generates resized versions about 5 times faster.
- Image lists, galleries, and albums use browser-native WebP thumbnails instead of QOI. A sample photo thumbnail shrank from 823 KB to 26 KB. Animated thumbnails retain animation.
- GIF conversion is 2–6 times faster, with files up to 13% larger. A 30-frame, 480×270 video took 1.7 seconds instead of 4.1; a worst-case noise animation took 4 seconds instead of 26, within the default time limit.
- Reuse image conversion workers. A small uncached conversion now takes about 20 ms instead of 120 ms. Workers are replaced after 50 conversions, a failure, or excessive retained memory, and stop after 30 seconds idle.

### Lighter

- Reduced memory use under load. Picsur now returns unused memory when idle. Docker measurements: 120 MB idle (previously 160 MB), about 250 MB under load (390 MB), and about 140 MB within 30 seconds after load. Outside Docker, use Node’s `--expose-gc` flag, as in `start:prod`.

### Changed

- Moved System Settings into Settings → Server and migrated saved values. Added environment variables for `PICSUR_CONVERSION_TIME_LIMIT`, `PICSUR_CONVERSION_MEMORY_LIMIT`, `PICSUR_ALLOW_EDITING`, `PICSUR_REMOVE_DERIVATIVES_AFTER`, `PICSUR_HOST_OVERRIDE`, `PICSUR_BCRYPT_STRENGTH`, `PICSUR_TRACKING_URL`, and `PICSUR_TRACKING_ID`. These settings and login expiry now apply without a restart.
- Saved settings now override `PICSUR_JWT_EXPIRY`. `PICSUR_VERBOSE` can also be changed on the settings page.
- The settings page displays environment-only options, such as the database connection.
- All boolean environment settings now accept `yes`, `no`, `1`, and `0` as well as `true` and `false`.
- Ackee tracking now requires both its URL and website ID. Removed the unused enable switch.

### Fixed

- Images set to expire after 6 hours expired after 2.
- Invalid role names now get role-specific errors instead of username errors.
- The upload page now explains missing upload permission instead of asking logged-in users to log in again.
- Added image titles as alt text and album names to cover descriptions for screen readers.
- Invalid width, height, or quality values in the customize dialog no longer remove all options from the image URL.
- Link previews now use the instance’s address and logo instead of picsur.org.
- Apply EXIF orientation to photos and every animation frame. Previously uploaded images are unchanged.
- Fixed conversion memory limits above about 1.5 GB, which could be ignored, reduced, or prevent conversions entirely.
- Fixed animation rotation at `90` and `270` degrees. `rotate=180` and `flipy` no longer reverse playback.

## 0.6.0

The first release of this fork, after Picsur 0.5.7. See [Upgrading from Picsur 0.5](README.md#upgrading-from-picsur-05) before updating.

### Security

- Closed privilege escalation through user, role, and API key management. Users can only manage accounts and roles whose permissions they hold; API keys are only shown to their owners.
- Fixed rate limiting, including protection against password guessing.
- Limited image conversion frequency, concurrency, and dimensions to prevent memory and disk exhaustion.
- New instances got the admin password `picsur` when `PICSUR_ADMIN_PASSWORD` was not set. A random one is generated instead, and a warning is logged when the admin still uses `picsur`.
- Changing a password now logs that user out everywhere.
- Deletion links deleted the image as soon as they were opened, including by the link previews of chat apps. They now ask for confirmation.
- API keys are now hashed and shown only at creation. Existing keys still work.
- `/api/user/me` handed out login tokens to API keys, which kept working after the key was deleted.
- The JWT secret could be read and changed through the settings API. It is now only set with `PICSUR_JWT_SECRET`, or generated on first start. Tokens are only accepted when signed with HS256.
- Replaced permissive URL validation that could take minutes to process malicious input.
- Logging in did not check the `user-login` permission of the user logging in, and the response time revealed which usernames exist.
- The statistics proxy served whatever the tracking server answered as if it came from Picsur, and passed on the visitor's credentials.
- Image metadata showed the uploader's roles to anyone who could view the image.
- Image workers could reach any libvips loader installed, like those for PDF or SVG, and inherited the server's environment and its secrets.
- The secret, the database password and attempted API keys were written to the logs.
- The content security policy allowed inline scripts. It no longer does, so markup that makes it into a page cannot run scripts.
- Resolved the dependency advisories known at release: 94 in the backend, including 4 critical. Upgraded Angular 18 to 22, addressing 17 advisories left unfixed in Angular 18.

### New

- Images can be stored in S3 compatible object storage instead of the database, with `PICSUR_STORAGE_DRIVER=s3` and the `PICSUR_S3_*` settings. Existing images can be moved in either direction with `node dist/cli.js storage migrate`.
- A Docker image for amd64 and arm64 at `ghcr.io/jeykang/npicsur`, with HEIC, JPEG XL and JPEG 2000 support. It runs as an unprivileged user.
- Users can change their own password under Settings → Account. This logs them out everywhere else.
- Added a light theme. The account-menu button switches between dark (default), light, and the system preference. The choice is saved per browser.
- Added an opt-in public gallery. Enable “Show in the public gallery” when editing an image. Guest and user roles receive the new “View the gallery” permission.
- Added My Albums to the account menu. Add images from their page or My Images. Anyone with the album link can view it. Deleting an album keeps its images; deleting a user removes their albums.
- `PICSUR_TRUST_PROXY`, `PICSUR_MAX_CONCURRENT_CONVERSIONS` and `PICSUR_CONVERSION_RATE_LIMIT`.
- An end-to-end test suite, run in CI with both storage drivers and against the Docker image.

### Changed

- Removed hourly telemetry reporting of hostname, user and image counts, CPU, and RAM to the original author. `PICSUR_TELEMETRY=false` had not disabled it.
- Requires Node.js 22.12 or newer; Node 24 is recommended. Uses NestJS 11, Fastify 5, and Angular 22.
- Rate limits are 300 requests a minute per address, with lower limits for logging in, registering, uploading and making changes.
- Deleting a user deletes their images as well. `node dist/cli.js images delete-orphaned` deletes the images of users deleted before.
- Unknown `/api` routes answer with a JSON 404 instead of the frontend.
- Image metadata is no longer cached for a month, and the placeholder for missing images is not cached at all.
- The "Source Code" link in the footer points to this fork.
- The ShareX config builder creates a new API key for every config, named ShareX.
- The package metadata names the AGPL-3.0, the license in `LICENSE`, instead of the GPL-3.0.

### Fixed

- Deleting with a deletion link failed for anyone without upload permission.
- Editing custom roles failed.
- Stopped rewriting cached conversions on every view and deleting active conversions during cleanup.
- With editing disabled, an unedited image was cached as the edited one.
- Invalid or oversized uploads now return a clear error instead of a generic server error.
- A failing conversion could crash the server.
- Renaming an API key to fewer than 3 characters broke the list of keys.
- Validate settings to prevent invalid values from locking users out or stalling logins.
- The cleanup of cached conversions can be turned off by setting it to 0, as its help text said.
- Generated secrets and keys never contained the last letter of the alphabet.
- `PICSUR_JWT_SECRET` and `PICSUR_JWT_EXPIRY` needed two restarts to take effect.
- The version was shown as 0.0.0 when not started through npm.
- The pages of images whose uploader was deleted failed to load.
- Deleting an image during conversion no longer causes an error or leaves a file in the bucket.
- Converting greyscale images with transparency to QOI or BMP failed, and the BMP decoder rejected some valid files.
- Pages now report connection failures and recover when the server returns. Previously, they could stay blank with a loading bar, or incorrectly ask users to log in.
- Preserve login state when the server is unavailable during page load.
- Show server error messages, such as rate limits, instead of “A network error occurred”.
