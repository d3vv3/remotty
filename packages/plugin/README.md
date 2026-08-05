# remotty

remotty is a remote PWA control surface for OpenCode sessions.

## Install

Install both the server and TUI plugin entries:

```sh
opencode plugin opencode-remotty --global --force
```

Create the relay identity and an encrypted device invite:

```sh
npx opencode-remotty pair
```

The CLI prints the raw invite token, a clickable fragment-only pairing link, and a terminal QR code. It copies the token to the clipboard when the system clipboard is available. The one-time invite expires after ten minutes.

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

Each device ID is the SHA-256 fingerprint of its signing public key. The readable device name contains the browser, operating system, and a short fingerprint. Active devices refresh this name when they connect.
