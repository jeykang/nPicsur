# Contributing

Report bugs and suggest features in [issues](https://github.com/jeykang/nPicsur/issues/new/choose). Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## Making a change

Follow the README’s [development setup](README.md#development). Before opening a pull request, run the CI checks:

```sh
pnpm exec prettier --check .
pnpm exec eslint .
pnpm --filter picsur-shared build
pnpm --filter picsur-backend build
pnpm --filter picsur-backend typecheck:test
pnpm --filter picsur-backend test:unit
pnpm --filter picsur-backend test:e2e
```

Use `pnpm format` and `pnpm lint` to apply formatting and lint fixes.

- Document user-visible changes under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md). Add the heading if needed. Describe the effect on users.
- Add database migrations to `backend/src/database/migrations` and register them in its `index.ts`. Name them after the target release, such as `V_0_8_0_a`.
- Cover API changes with end-to-end tests in `backend/test/e2e`.

Contributions use the project’s [AGPL-3.0 license](LICENSE).

## Dependencies

[Dependabot](.github/dependabot.yml) checks npm packages, GitHub Actions, and the Dockerfile’s Node image weekly. Security updates are proposed as soon as GitHub reports them. CI checks every update.

Minor and patch npm updates share one pull request; security fixes share another. Major updates get separate pull requests on the next weekly run after the minor and patch update is merged. NestJS updates stay in their own group because its packages must stay compatible.

To enable Dependabot in a fork, go to Settings → Advanced Security and enable the dependency graph, alerts, security updates, and version updates.

Update these manually:

- **Angular major versions:** run `ng update` for migrations. Update TypeScript and zone.js alongside Angular.
- **Node major versions:** update `.nvmrc`, `@types/node`, and all three `FROM` lines in the Dockerfile.
- **Alpine:** change the Node image tag (such as `-alpine3.24`) and digest in all three `FROM` lines. Find the digest with `docker buildx imagetools inspect node:<tag>`.
- **libvips:** update `VIPS_VERSION` and set `VIPS_SHA256` to the release archive’s `sha256sum` (`vips-<version>.tar.xz`).

### Known vulnerabilities

Run `pnpm vulnerabilities` to check the lockfile against the GitHub Advisory Database. It tries updates within the declared version ranges on a copy of the lockfile, then prints commands to apply them in order.

Remaining fixes may require widening a version range, upgrading a major version, or waiting for a parent dependency to update. A temporary override in `pnpm-workspace.yaml` can force a fix; comment why it is needed and when to remove it.

The report shows where each package is used and whether it runs in the Docker backend. Read each advisory’s affected conditions. Issues limited to unused features, such as Angular server rendering or a Windows development server, can wait for a regular update.

## Releasing

1. Rename `## Unreleased` in the changelog to the new version, such as `## 0.8.0`.
2. Set the version with `pnpm setversion 0.8.0`.
3. After merging, tag master and push the tag:

   ```sh
   git fetch origin
   git tag v0.8.0 origin/master
   git push origin v0.8.0
   ```

CI tests the tag, publishes Docker tags `0.8.0`, `0.8`, and `latest`, then creates a GitHub release from the changelog. The tag must match the version in `package.json` and the changelog, or publication fails.

To regenerate a release after correcting its notes, run the Release workflow manually.
