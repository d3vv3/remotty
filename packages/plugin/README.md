# remotty

remotty is a remote PWA control surface for OpenCode sessions.

## Install

Add the npm package to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-remotty"]
}
```

Create a pairing key for your remotty broker:

```sh
npx opencode-remotty pair --broker wss://your-remotty-domain.example/ws
```

The CLI prints the key, a pairing deep link, and a terminal QR code. Scan the QR with your phone camera or the scanner in the remotty pairing screen.

Restart OpenCode after installation.

## Commands

```sh
npx opencode-remotty pair --broker wss://your-remotty-domain.example/ws
npx opencode-remotty pair --broker wss://broker.example/ws --app https://app.example
npx opencode-remotty status
```

The plugin keeps its credential in `~/.config/remotty/config.json` with mode `0600`.
