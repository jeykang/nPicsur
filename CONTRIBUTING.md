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
