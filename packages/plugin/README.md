# remotty

remotty is a remote PWA control surface for OpenCode sessions.

## Install

Add the npm package to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-remotty"]
}
```

Create a pairing key:

```sh
npx opencode-remotty pair
```

The CLI prints the key, a pairing deep link, and a terminal QR code. Scan the QR with your phone camera or the scanner in the remotty pairing screen.

Restart OpenCode after installation.

## Commands

```sh
npx opencode-remotty pair
npx opencode-remotty status
```

The plugin keeps its credential in `~/.config/remotty/config.json` with mode `0600`.
