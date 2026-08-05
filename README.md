# remotty

remotty is a remote TTY-style PWA for local OpenCode sessions. It shows live messages, diffs, todos, questions, permission requests, and agent state. It can send prompts, stop work, switch agents, and reply to permissions from native Push notifications.

The local OpenCode plugin makes an outbound WebSocket connection to the broker. OpenCode stays bound to the local machine.

## Packages

- `packages/plugin`: publishable `opencode-remotty` npm plugin and CLI
- `packages/protocol`: private validated relay protocol
- `apps/broker`: WebSocket and Web Push broker
- `apps/web`: installable React PWA

## Install the OpenCode plugin

Install with one command. It registers the plugin in the OpenCode configuration; no manual `tui.json` edit is needed:

```sh
opencode plugin opencode-remotty --global --force
```

Create the relay identity and a ten-minute encrypted device invite:

```sh
npx opencode-remotty pair
```

Restart OpenCode. Paste the printed invite token into the PWA or open the clickable pairing link.

The pairing command prints the invite token, the pairing link, and a QR code. Copy the token, open the link, or scan the code with your phone camera or the scanner beside the pairing input.

The CLI writes relay authority keys, device records, and invitation hashes to `~/.config/remotty/config.json` with mode `0600`. These environment variables override non-secret settings:

```sh
REMOTTY_URL=wss://your-remotty-domain.example/ws
REMOTTY_NAME=workstation
```

## Run locally

Requirements: Node 22 or later, pnpm 11, and OpenCode.

```sh
pnpm install
pnpm build
node packages/plugin/dist/cli.js pair
pnpm dev
```

Open `http://localhost:5173/pair` and enter the encrypted invite.

## Deploy

Copy `.env.production.example` to `.env`, set the hostname and stable VAPID keys, then build both containers:

```sh
docker compose up -d --build
```

The Compose file expects an external `traefik` network. It routes `/ws`, `/push/*`, and `/health` to the broker. It routes all other paths to the PWA.

The web build uses `wss://${REMOTTY_HOST}/ws` as its broker URL.

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

Use `remotty invite`, `remotty devices`, and `remotty revoke <device-id>` to manage browser access.
The device ID is the SHA-256 fingerprint of its signing public key, not a random UUID. The device list also shows a browser, operating-system, and short-fingerprint label. Active devices refresh old labels when they connect.

A running relay pushes the revocation to the device within seconds, and the device unpairs itself. A revoked device that is offline stays in the list as a tombstone until it connects once more. Use `remotty remove <device-id>` or `remotty remove --revoked` to delete records that never reconnect.

The hosted service privacy design is available at `https://remotty.devve.space/privacy`.

## Verify

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm pack:plugin
```

## Release

Increment `packages/plugin/package.json`. A push to `main` creates `vX.Y.Z`, creates a GitHub release, verifies the monorepo, and publishes `opencode-remotty` through npm trusted publishing.

## License

remotty is licensed under the GNU Affero General Public License v3.0 only. See `LICENSE`.
