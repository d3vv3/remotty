# Contributing

## Bootstrap

Use Node 24 for repository parity (the plugin itself supports Node `>=22`) and pnpm 11.6.0:

```sh
corepack enable
corepack prepare pnpm@11.6.0 --activate
pnpm install --frozen-lockfile
```

The workspace contains the broker (`apps/broker`), PWA (`apps/web`), shared protocol (`packages/protocol`), and publishable OpenCode plugin (`packages/plugin`). Keep changes and tests in the owning package unless a shared contract requires coordinated work.

## Test and verify

Run a focused package test while iterating:

```sh
pnpm --filter @remotty/web test -- publicDiscovery
pnpm --filter opencode-remotty test -- cli-core
pnpm --filter @remotty/protocol test
pnpm --filter @remotty/broker test
```

Before proposing a cross-package change, run:

```sh
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

For a publishable plugin change, also inspect the package artifact without publishing:

```sh
pnpm --filter opencode-remotty pack --dry-run
```

There is no lint command. `apps/web/public/notification-sw.js` is source; do not edit generated `dist/`, `dev-dist/`, or `.vite/` output.

## Dependencies and docs

Use `pnpm` for dependency changes and commit the resulting `pnpm-lock.yaml` only when dependency manifests change. Do not hand-edit lockfile entries. Keep the broker's opaque-ciphertext boundary intact, and treat protocol updates as coordinated compatibility work across broker, web, and plugin.

Document user-visible install, configuration, command, security, and deployment changes in the root README and relevant package or public discovery documentation.
