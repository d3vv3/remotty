# remotty

remotty is a remote TTY-style PWA for local OpenCode sessions. It shows live messages, diffs, todos, questions, permission requests, and agent state. It can send prompts, stop work, switch agents, and reply to permissions from native Push notifications.

The local OpenCode plugin makes an outbound WebSocket connection to the broker. OpenCode stays bound to the local machine.

## Packages

- `packages/plugin`: publishable `opencode-remotty` npm plugin and CLI
- `packages/protocol`: private validated relay protocol
- `apps/broker`: WebSocket and Web Push broker
- `apps/web`: installable React PWA

## Install the OpenCode plugin

Requirements: OpenCode and Node `>=22` for `npx`. Install the plugin; it registers itself in OpenCode's global configuration, so no manual `tui.json` edit is needed:

```sh
opencode plugin opencode-remotty --global --force
```

Create the relay identity and a ten-minute encrypted device invite:

```sh
npx --yes --package opencode-remotty@latest remotty pair
```

The command mutates `~/.config/remotty/config.json` (or `$XDG_CONFIG_HOME/remotty/config.json`) and prints a sensitive ten-minute token, pairing link, and QR code. Do not share or publish them. Open the link, scan the QR code, or paste the token into the [pairing page](https://remotty.devve.space/pair). Quit any running OpenCode process, then start it again:

```sh
opencode --continue
```

Each command uses `npx --yes --package opencode-remotty@latest remotty` so it does not depend on a PATH-installed binary. For example:

```sh
npx --yes --package opencode-remotty@latest remotty invite
npx --yes --package opencode-remotty@latest remotty devices
npx --yes --package opencode-remotty@latest remotty status
```

See the [install guide](https://remotty.devve.space/install/) for hosted and custom-broker commands.

The CLI writes relay authority keys, device records, and invitation hashes to its config file with mode `0600`. These environment variables override non-secret settings:

```sh
REMOTTY_URL=wss://your-remotty-domain.example/ws
REMOTTY_NAME=workstation
```

## Run locally

Requirements: Node 24 for repository parity, pnpm 11.6.0, and OpenCode. Use two terminals:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

In the second terminal, pair the built local CLI with both local endpoints:

```sh
REMOTTY_URL=ws://localhost:8787/ws REMOTTY_APP_URL=http://localhost:5173 node packages/plugin/dist/cli.js pair
```

Open the printed link or `http://localhost:5173/pair`. Quit any running OpenCode process, then run `opencode --continue`. The pairing bundle carries the broker URL; the web build does not need a broker URL environment variable.

## Deploy

Copy `.env.production.example` to `.env`, set the hostname and stable VAPID keys, then build both containers:

```sh
docker compose up -d --build
```

The Compose file expects an external `traefik` network. It routes `/ws`, `/push/*`, and `/health` to the broker. Known public and PWA paths route to the web app; unknown web paths return 404.

Pairing bundles carry the broker URL, so the web image has no broker URL build argument.

Set stable VAPID keys on the broker so Push subscriptions survive deployment:

```sh
PORT=8787
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@example.com
```

Push and PWA installation require HTTPS outside localhost. The current broker keeps room metadata and Push subscriptions in memory. Use shared persistence before running multiple broker replicas.

## Data boundary

The broker does not receive plaintext chat messages, diffs, commands, or notification content. It routes signed ciphertext and keeps WebSocket and Push routing state in memory.

The room identifier is the relay authority fingerprint and grants no command authority. P-256 ECDH, HKDF-SHA-256, AES-256-GCM, and ECDSA protect application payloads end to end. The relay rejects stale, replayed, unsigned, unknown-device, and revoked-device commands. The broker still sees room and device identifiers, Push endpoints, frame sizes, and timing, and it can delay or drop traffic.

Use `npx --yes --package opencode-remotty@latest remotty invite`, `npx --yes --package opencode-remotty@latest remotty devices`, and `npx --yes --package opencode-remotty@latest remotty revoke <device-id>` to manage browser access. The device ID is the SHA-256 fingerprint of its signing public key, not a random UUID; the list includes a browser, operating-system, and short-fingerprint label.

A running relay pushes a revocation to the device within seconds, and the device unpairs itself. A revoked offline device remains as a tombstone until it connects once more. Use `npx --yes --package opencode-remotty@latest remotty remove <device-id>` or `npx --yes --package opencode-remotty@latest remotty remove --revoked` to delete records that never reconnect.

The hosted service privacy design is available at `https://remotty.devve.space/privacy`.

## Verify

```sh
pnpm typecheck
pnpm test
pnpm build
```

For publishable plugin changes, run `pnpm --filter opencode-remotty pack --dry-run` to inspect the package without publishing.

## Release

A push to `main` checks whether `packages/plugin/package.json` differs from the published npm version. A version change triggers verification, trusted npm publishing, a `vX.Y.Z` tag, and a GitHub release. Version changes therefore carry a release risk; verify the package and release intent before merging.

## Documentation

- [Install guide](https://remotty.devve.space/install/)
- [Agent discovery](https://remotty.devve.space/llms.txt)
- [Contributing](CONTRIBUTING.md)
- [Repository agent guide](AGENTS.md)

## License

remotty is licensed under the GNU Affero General Public License v3.0 only. See `LICENSE`.
