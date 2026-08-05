# remotty

remotty is a remote PWA control surface for OpenCode sessions.

## Install

Install with one command. It registers the plugin in the OpenCode configuration; no manual `tui.json` edit is needed:

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
npx opencode-remotty remove <device-id>
npx opencode-remotty remove --revoked
npx opencode-remotty status
```

The plugin keeps relay authority keys, invitation hashes, device keys, revocation state, and replay records in `~/.config/remotty/config.json` with mode `0600`. The broker routes only opaque encrypted frames.

Each device ID is the SHA-256 fingerprint of its signing public key. The readable device name contains the browser, operating system, and a short fingerprint. Active devices refresh this name when they connect.

A revoked device stays in the list as a tombstone until it connects once more. The relay then tells the device it was revoked and deletes the record. `remove` deletes records that never reconnect; `remove --revoked` clears all tombstones at once.
