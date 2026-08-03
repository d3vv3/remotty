# remotty

remotty is a remote PWA control surface for OpenCode sessions.

## Install

Add the npm package to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-remotty"]
}
```

Create the relay identity and an encrypted device invite:

```sh
npx opencode-remotty pair
```

The CLI prints a fragment-only pairing link and a terminal QR code. The one-time invite expires after ten minutes.

Restart OpenCode after installation.

## Commands

```sh
npx opencode-remotty pair
npx opencode-remotty invite
npx opencode-remotty devices
npx opencode-remotty revoke <device-id>
npx opencode-remotty status
```

The plugin keeps relay authority keys, invitation hashes, device keys, revocation state, and replay records in `~/.config/remotty/config.json` with mode `0600`. The broker routes only opaque encrypted frames.
