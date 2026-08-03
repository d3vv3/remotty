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

Restart OpenCode after installation.

## Commands

```sh
npx opencode-remotty pair --broker wss://your-remotty-domain.example/ws
npx opencode-remotty status
```

The plugin keeps its credential in `~/.config/remotty/config.json` with mode `0600`.
