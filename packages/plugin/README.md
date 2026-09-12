# remotty

remotty is a remote PWA control surface for OpenCode sessions.

## Install

Requirements: OpenCode and Node `>=22` for `npx`. Install with one command. It registers the plugin in the OpenCode configuration; no manual `tui.json` edit is needed:

```sh
opencode plugin opencode-remotty --global --force
```

Create the relay identity and an encrypted device invite:

```sh
npx --yes --package opencode-remotty@latest remotty pair
```

The command mutates `~/.config/remotty/config.json` (or `$XDG_CONFIG_HOME/remotty/config.json`) and prints a sensitive token, clickable fragment-only pairing link, and terminal QR code. Do not share or publish this output. The one-time invite expires after ten minutes.

Open the pairing link, scan its QR code, or paste the token into `https://remotty.devve.space/pair`. Quit any running OpenCode process, then run `opencode --continue` after installation and pairing.

## Commands

```sh
npx --yes --package opencode-remotty@latest remotty pair
npx --yes --package opencode-remotty@latest remotty invite
npx --yes --package opencode-remotty@latest remotty devices
npx --yes --package opencode-remotty@latest remotty revoke <device-id>
npx --yes --package opencode-remotty@latest remotty remove <device-id>
npx --yes --package opencode-remotty@latest remotty remove --revoked
npx --yes --package opencode-remotty@latest remotty status
```

The plugin keeps relay authority keys, invitation hashes, device keys, revocation state, and replay records in `~/.config/remotty/config.json` with mode `0600`. The broker routes only opaque encrypted frames.

Each device ID is the SHA-256 fingerprint of its signing public key. The readable device name contains the browser, operating system, and a short fingerprint. Active devices refresh this name when they connect.

A running relay sends revocation over the browser's established connection, and the device unpairs itself when it receives it. A revoked device that is offline stays in the list as a tombstone until it connects once more. `remove` deletes records that never reconnect; `remove --revoked` clears all tombstones at once. Attachment images cached locally in the browser remain subject to cache eviction until its identity is deleted or revocation is received on the next connection. Remote wiping of a closed or offline PWA is not guaranteed.
