# remotty

remotty is a remote TTY-style PWA for local OpenCode sessions. It shows live messages, diffs, todos, questions, permission requests, and agent state. It can send prompts, stop work, switch agents, and reply to permissions from native Push notifications.

The local OpenCode plugin makes an outbound WebSocket connection to the broker. OpenCode stays bound to the local machine.

## Packages

- `packages/plugin`: publishable `opencode-remotty` npm plugin and CLI
- `packages/protocol`: private validated relay protocol
- `apps/broker`: WebSocket and Web Push broker
- `apps/web`: installable React PWA

## Install the OpenCode plugin

Add the package to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-remotty"]
}
```

Create a 256-bit pairing key:

```sh
npx opencode-remotty pair --broker wss://your-remotty-domain.example/ws
```

Restart OpenCode. Paste the printed key into the PWA.

The CLI writes `~/.config/remotty/config.json` with mode `0600`. These environment variables override that file:

```sh
REMOTTY_URL=wss://your-remotty-domain.example/ws
REMOTTY_KEY=your-pairing-key
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

Open `http://localhost:5173` and enter the pairing key.

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

The broker does not store chat messages or diff responses. It forwards those frames and discards them. It keeps only the latest session metadata snapshot and Push subscriptions in memory.

The pairing key is a 256-bit bearer credential sent in the WebSocket subprotocol header. Before public production use, add account authentication, credential rotation, end-to-end room encryption, replay protection, rate limits, and stronger confirmation for dangerous approvals.

## Verify

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm pack:plugin
```

## Release

Increment `packages/plugin/package.json`. A push to `main` creates `vX.Y.Z`, creates a GitHub release, verifies the monorepo, and publishes `opencode-remotty` through npm trusted publishing.
