# Network Test Matrix

Run the web app and a local broker/plugin pair, then apply each condition to the active browser or broker network interface. Remove shaping with `sudo tc qdisc del dev <interface> root` after every case.

| Condition | Command | Expected result |
| --- | --- | --- |
| Latency and jitter | `sudo tc qdisc replace dev <interface> root netem delay 400ms 150ms` | Status becomes Unstable when pings time out; cached content remains readable. |
| Packet loss | `sudo tc qdisc replace dev <interface> root netem loss 25%` | Read-only sync retries after reconnect; a lost prompt acknowledgement is shown as Delivery uncertain rather than replayed. |
| Full outage | `sudo tc qdisc replace dev <interface> root netem loss 100%` | Service and computer rows show offline; reconnect resumes on network recovery. |
| Large messages | Use a session with multi-megabyte tool output while `delay 200ms` is active | User/newest message chunks appear before bulk tool data and status refreshes remain responsive. |
| Delta tail sync | Refresh an unchanged 80-message session, then edit one message | An unchanged refresh sends only a small manifest; one changed message sends the manifest plus that record. The known-inventory control frame remains below the broker 100KB limit. |
| Interrupted delta resume | Disconnect after a delta manifest and one chunk, then reconnect | Verified records remain visible as staged data; no prior canonical record is deleted until a complete replacement manifest commits. The resumed request advertises staged fingerprints and only retransfers missing bodies. |
| Prompt acknowledgement lag | Acknowledge a prompt, then omit it from two completed tail syncs | The first miss remains accepted because a tail can lag acknowledgement; the second becomes uncertain while retaining its text. Legacy acknowledgements keep an uncertain placeholder until matching canonical user text reconciles it. |
| Interrupted session creation | Create a session, then disconnect before its acknowledgement arrives | Creation is reported as uncertain and is not automatically replayed. Refreshing reveals the session if OpenCode accepted it. |
| Relay restart | Restart OpenCode/plugin during an active session | Browser detects the new sequence instance and obtains a fresh snapshot. |
