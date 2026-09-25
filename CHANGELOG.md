# Changelog

## Unreleased

### New

- A settings page for the server itself, under Settings → Server: where images are stored, including the S3 connection and a way to test it, the upload size, the conversion limits and the trusted proxies. Picsur restarts itself to apply them, and goes back to the settings it had before when it can not start with the new ones. Environment variables still work and take precedence, the page shows those settings but can not change them.
- Settings made with environment variables are saved on that page as well, so the variables can be removed to manage the settings there instead, without anything changing. The page lists the variables that can go.
- Secrets saved on that page are encrypted. By default with a generated key that is kept in the database. The new `PICSUR_ENCRYPTION_KEY` keeps the key out of the database, which protects secrets from copies of it as well. Secrets saved before it was set are encrypted with it when Picsur starts.
- Images can be moved between the database and S3 from that page, which shows how far along it is. Picsur keeps working in the meantime.
- The command line tool uses the settings from the page as well.
- APNG, ICO and TGA images can be uploaded, and any image can be converted to them. Animated PNGs stay animated, also when converted to GIF or WebP and the other way around, and are kept as they were uploaded, like PNG images. Icons are read from their largest image, and written with images of at most 256 pixels. TGA images are read in all their variants, including run length encoded and color-mapped ones.
- Images can be stored as files in a directory, besides the database and S3, with `PICSUR_STORAGE_DRIVER=filesystem` and `PICSUR_STORAGE_PATH`, or on the settings page. The Docker image has `/picsur/images` ready for a volume, and the settings page warns when the directory is not on one. Images can be moved between any of the three, and `storage gc` cleans up the directory too.

### Faster

- JPEG, PNG, WebP and GIF uploads are kept as they were uploaded, only without their metadata, instead of being converted to QOI. A lossless copy of a photo is many times larger than the photo itself while holding nothing more: a 12 megapixel JPEG used to take up 9 times its size. Uploading it is about 9 times faster now, and making a smaller version of it about 5 times. Other formats are still converted to QOI. Images uploaded before stay as they are.
- Lists of images, the gallery and albums load WebP thumbnails instead of QOI ones. The thumbnail of a photo is about 30 times smaller, 26 KB instead of 823 KB, and browsers show them without decoding them in a script first. Thumbnails of animations are animated.
- The processes that convert images are used for more than one conversion, instead of starting a new one every time, which took longer than converting most images. A small image that was not converted to the requested size and format before is ready in about 20 ms instead of 120 ms. A process is replaced after 50 conversions, when a conversion fails, or when it holds on to a lot of memory afterwards, and stops after 30 seconds without work.

### Lighter

- Picsur gives back the memory it took while it was busy once it is idle again, instead of keeping it until it restarts, and takes less of it while busy. Measured with the Docker image: 120 MB when idle instead of 160 MB, about 250 MB instead of 390 MB while handling a lot of requests, and back to about 140 MB within half a minute after. Outside the Docker image, this needs Node to be started with `--expose-gc`, see the `start:prod` script.

### Fixed

- Photos were shown sideways when their EXIF orientation said to turn them, like phones do for photos taken upright. Animations are turned as well, each frame by itself. Images uploaded before stay as they are.
- Conversion memory limits above about 1.5 GB were not applied as set: depending on the value, conversions had no memory limit at all, a much lower one, or could not run at all.

## 0.6.0

The first release of this fork, after Picsur 0.5.7. See [Upgrading from Picsur 0.5](README.md#upgrading-from-picsur-05) before updating.

### Security

- Users allowed to manage users, roles or api keys could make themselves administrator: by changing the admin's password, giving themselves the admin role, adding permissions to their own role, or reading the admin's api keys. Users and roles can now only be managed by someone who has every permission they have, and api keys are only ever shown to their owner.
- Rate limiting did not work at all, which left password guessing unthrottled.
- Anyone who could view an image could make the server convert it to any size and format without limit, exhausting memory and disk. Conversions are now limited per visitor and overall, and in size.
- New instances got the admin password `picsur` when `PICSUR_ADMIN_PASSWORD` was not set. A random one is generated instead, and a warning is logged when the admin still uses `picsur`.
- Changing a password now logs that user out everywhere.
- Deletion links deleted the image as soon as they were opened, including by the link previews of chat apps. They now ask for confirmation.
- Api keys were stored as they are, so anyone who could read the database or a backup of it could use them. Only a hash of them is stored now, and they are only shown once, when they are created. Existing keys keep working.
- `/api/user/me` handed out login tokens to api keys, which kept working after the key was deleted.
- The JWT secret could be read and changed through the settings api. It is now only set with `PICSUR_JWT_SECRET`, or generated on first start. Tokens are only accepted when signed with HS256.
- Url settings were checked with a regular expression that accepted almost anything and could be made to run for minutes.
- Logging in did not check the `user-login` permission of the user logging in, and the response time revealed which usernames exist.
- The statistics proxy served whatever the tracking server answered as if it came from Picsur, and passed on the visitor's credentials.
- Image metadata showed the uploader's roles to anyone who could view the image.
- Image workers could reach any libvips loader installed, like those for PDF or SVG, and inherited the server's environment and its secrets.
- The secret, the database password and attempted api keys were written to the logs.
- The content security policy allowed inline scripts. It no longer does, so markup that makes it into a page can not run scripts.
- No dependency has a known vulnerability anymore. The server's had 94, 4 of them critical. The frontend used Angular 18, which no longer gets security fixes, with 17 advisories against it that were never fixed for 18, it now uses Angular 22.

### New

- Images can be stored in S3 compatible object storage instead of the database, with `PICSUR_STORAGE_DRIVER=s3` and the `PICSUR_S3_*` settings. Existing images can be moved in either direction with `node dist/cli.js storage migrate`.
- A Docker image for amd64 and arm64 at `ghcr.io/jeykang/npicsur`, with HEIC, JPEG XL and JPEG 2000 support. It runs as an unprivileged user.
- Users can change their own password, under settings, account. This logs them out everywhere else.
- A light theme. The button next to the account menu switches between dark (still the default), light and following the system, for each browser.
- A public gallery, of the images their owners chose to show there with "Show in the public gallery" when editing them. It needs the new "View Gallery" permission, which the guest and user roles get.
- Albums, under "My Albums" in the account menu. Images are added with the album button on their page or on "My Images". Like images, anyone with the link can see an album. Deleting an album keeps its images, and albums are deleted along with their user.
- `PICSUR_TRUST_PROXY`, `PICSUR_MAX_CONCURRENT_CONVERSIONS` and `PICSUR_CONVERSION_RATE_LIMIT`.
- An end-to-end test suite, run in CI with both storage drivers and against the Docker image.

### Changed

- Telemetry is removed. Every instance reported its hostname, user and image counts, CPU and RAM to the original author's server every hour, and `PICSUR_TELEMETRY=false` did not turn it off.
- Requires Node.js 22.12 or newer, 24 is recommended. The backend runs on NestJS 11 and Fastify 5, the frontend on Angular 22.
- Rate limits are 300 requests a minute per address, with lower limits for logging in, registering, uploading and making changes.
- Deleting a user deletes their images as well. `node dist/cli.js images delete-orphaned` deletes the images of users deleted before.
- Unknown `/api` routes answer with a JSON 404 instead of the frontend.
- Image metadata is no longer cached for a month, and the placeholder for missing images is not cached at all.
- The "Source Code" link in the footer points to this fork.
- The ShareX config builder creates a new api key for every config, named ShareX.
- The package metadata names the AGPL-3.0, the license in `LICENSE`, instead of the GPL-3.0.

### Fixed

- Deleting with a deletion link failed for anyone without upload permission.
- Editing custom roles failed.
- Cached conversions were rewritten on every view, and the ones not viewed for a day were cleaned up while still in use.
- With editing disabled, an unedited image was cached as the edited one.
- Uploading something that is not an image, or too large, gave a server error instead of a clear one.
- A failing conversion could crash the server.
- Renaming an api key to fewer than 3 characters broke the list of keys.
- Settings only accept sensible values, so a typo can no longer lock everyone out or make every login hang.
- The cleanup of cached conversions can be turned off by setting it to 0, as its help text said.
- Generated secrets and keys never contained the last letter of the alphabet.
- `PICSUR_JWT_SECRET` and `PICSUR_JWT_EXPIRY` needed two restarts to take effect.
- The version was shown as 0.0.0 when not started through npm.
- The pages of images whose uploader was deleted failed to load.
- Deleting an image while a converted version of it was being made gave an error, and could leave a file behind in the bucket.
- Converting greyscale images with transparency to QOI or BMP failed, and the BMP decoder rejected some valid files.
- While the server could not be reached, pages stayed empty with the loading bar running forever, and the upload page asked to log in. They now say that the server can not be reached, and continue by themselves once it is back.
- Being logged in did not survive the server being unreachable while a page loaded.
- Error messages of the server, like that a rate limit was reached, were shown as "A network error occurred".
