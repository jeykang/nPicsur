# Contributing

Bugs and ideas go in the [issues](https://github.com/jeykang/nPicsur/issues/new/choose). Security problems are reported privately instead, see [SECURITY.md](SECURITY.md).

## Making a change

Set up the development database and start Picsur as described under [Development](README.md#development) in the README. Before opening a pull request, run what CI runs:

```sh
pnpm exec prettier --check .
pnpm exec eslint .
pnpm --filter picsur-shared build
pnpm --filter picsur-backend build
pnpm --filter picsur-backend typecheck:test
pnpm --filter picsur-backend test:unit
pnpm --filter picsur-backend test:e2e
```

`pnpm format` and `pnpm lint` fix most of what the first two find.

- What users notice gets a line in [CHANGELOG.md](CHANGELOG.md), under `## Unreleased` at the top. Add that heading when it is not there. Say what changed for someone running Picsur, not how.
- Changes to the database need a migration in `backend/src/database/migrations`, named after the release it goes into, like `V_0_8_0_a`, and listed in its `index.ts`.
- Changes to the api come with end-to-end tests in `backend/test/e2e`.

Contributions are licensed under the [AGPL-3.0](LICENSE), like the rest of Picsur.

## Dependencies

[Dependabot](.github/dependabot.yml) opens pull requests every week for new versions of the npm packages, the GitHub Actions and the Node image of the Dockerfile, and for security fixes as soon as GitHub reports a vulnerability. CI runs on each of them. Minor versions and patches of npm packages are grouped into one pull request, and their security fixes into another. New major versions come on their own, as they may need changes to the code. Dependabot holds them back while the pull request of minor versions and patches is open, so they come with the first weekly run after it is merged. Every update of NestJS comes in a pull request of its own, as its packages need each other.

GitHub keeps Dependabot off in forks like this repository. To turn it on, go to Settings → Advanced Security and enable the dependency graph, Dependabot alerts, Dependabot security updates and Dependabot version updates.

Dependabot leaves these to be done by hand:

- New major versions of Angular, which need its migrations with `ng update`. TypeScript and zone.js move along with Angular.
- New major versions of Node: change `.nvmrc`, `@types/node` and the three `FROM` lines of the Dockerfile together.
- A new version of Alpine, which is part of the tag of the Node image, like `-alpine3.24`. Dependabot only proposes images for the same one. Change the tag and the digest in the three `FROM` lines, `docker buildx imagetools inspect node:<tag>` shows the digest.
- libvips, which the Dockerfile builds from source. Set `VIPS_VERSION` to the new release, and `VIPS_SHA256` to the `sha256sum` of its `vips-<version>.tar.xz`.

### Known vulnerabilities

`pnpm vulnerabilities` lists the known vulnerabilities in the lockfile, from the GitHub Advisory Database like Dependabot's alerts, and what fixes each. It tries updates within the ranges in package.json on a copy of the lockfile, and prints the commands that make them, to run in that order. What is left needs a new range in a package.json, a new major version, or a new version of a package that depends on it. Until there is one, an override in `pnpm-workspace.yaml` can force the fix, with a comment that says why, to remove it again later.

Each advisory comes with where the package is used, and whether the backend runs with it in the Docker image. Some only matter for what Picsur does not do, like rendering Angular on the server, or running a development server on Windows. Those can wait for the next regular update, the description of the advisory says when it applies.

## Releasing

1. In the changelog, rename `## Unreleased` to the new version, like `## 0.8.0`.
2. Set that version with `pnpm setversion 0.8.0`.
3. Once that is merged, tag master and push the tag:

   ```sh
   git fetch origin
   git tag v0.8.0 origin/master
   git push origin v0.8.0
   ```

CI tests the tag, publishes the Docker image as `0.8.0`, `0.8` and `latest`, and then creates the GitHub release with that version's notes from the changelog. When the version in `package.json` or the changelog does not match the tag, CI fails, and neither the image nor the release is published.

The release of a tag can be made again from the changelog, for example after fixing its notes, by running the Release workflow by hand.
