# Agent Guide

## Repository rules

- Use Node 24 for repository parity. The published plugin supports Node `>=22`.
- Use pnpm `11.6.0` (Corepack is used in CI and Docker) and install with `pnpm install --frozen-lockfile`.
- This is a pnpm workspace: `apps/broker` is the relay broker, `apps/web` is the PWA, `packages/protocol` is the validated shared protocol, and `packages/plugin` is the publishable OpenCode plugin and CLI. Keep changes within the appropriate package boundary.
- The broker must only route opaque ciphertext. Do not introduce plaintext messages, commands, diffs, or notification content at the broker boundary.
- Treat protocol changes as compatibility-sensitive: they affect the plugin, web app, and broker together. Update coverage across affected packages.
- `apps/web/public/notification-sw.js` is authored source, even though it is imported into the generated service worker. Do not edit generated `dist/`, `dev-dist/`, `.vite/`, or `node_modules/` output.
- Add focused tests for behavior changes. Run `pnpm typecheck`, `pnpm test`, and `pnpm build` for cross-package changes. There is no lint script.
- The manual network matrix uses `sudo tc`; do not run it without explicit approval.
- Preserve unrelated working-tree changes, including untracked files. Do not touch `.serena/`.

## Approval boundaries

Do not pair, create invites, revoke or remove devices, publish packages, bump versions, deploy, run `sudo tc`, or start an externally bound development server without explicit user approval. Do not edit the release workflow unless explicitly asked.

## Release behavior

The release workflow runs on pushes to `main`. It compares `packages/plugin/package.json` with the npm version and, only when changed, verifies the monorepo, publishes `opencode-remotty`, tags `vX.Y.Z`, and creates a GitHub release. Treat plugin version changes as release-triggering.
