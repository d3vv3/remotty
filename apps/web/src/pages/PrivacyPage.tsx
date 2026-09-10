import { useEffect } from "react"
import { LockKeyhole, ShieldAlert } from "lucide-react"
import { PublicFooter, PublicHeader } from "../components/public"
import "../public.css"

const handling = [
  ["Session content", "Encrypted in transit. The broker holds frames only while it routes them and does not write chat content to storage."],
  ["Device secrets", "Relay private keys stay in the local config. Browser private keys stay in IndexedDB. One-time invite secrets expire or disappear after use."],
  ["Push notifications", "The broker and Push provider receive encrypted notification envelopes. Your service worker verifies and decrypts them on the device."],
  ["Visible metadata", "The service can see IP addresses, request times, message sizes, opaque room and device IDs, delivery timing, and Push endpoints."],
  ["Tracking", "The PWA has no account, analytics, advertising tracker, or application cookie."],
]

export function PrivacyPage() {
  useEffect(() => {
    const previous = document.title
    document.title = "Privacy | remotty"
    return () => { document.title = previous }
  }, [])

  return (
    <main className="public-page">
      <PublicHeader active="privacy" />
      <section className="privacy-masthead">
        <p className="public-kicker"><LockKeyhole aria-hidden="true" /> Privacy design / audited boundary</p>
        <h1>Your OpenCode content stays between <em>your devices.</em></h1>
        <p>remotty uses end-to-end encryption. The hosted broker routes ciphertext and keeps no chat history. You can verify the design in the public source.</p>
      </section>

      <section className="public-band" aria-labelledby="encryption-title">
        <div className="public-section-heading"><p className="public-kicker">01 / How it works</p><h2 id="encryption-title">Encryption starts before the network.</h2></div>
        <ol className="numbered-workflow">
          <li><span>01</span><div><h3>Create local keys</h3><p>The OpenCode plugin creates relay keys. Each browser creates separate device keys during a ten-minute, one-time enrollment.</p></div></li>
          <li><span>02</span><div><h3>Encrypt and sign</h3><p>P-256 key agreement and HKDF derive AES-256-GCM keys. Signed commands bind every action to an enrolled device.</p></div></li>
          <li><span>03</span><div><h3>Route ciphertext</h3><p>The broker forwards encrypted frames. It cannot read sessions, tool output, questions, approvals, prompts, or notification text.</p></div></li>
        </ol>
      </section>

      <section className="public-band privacy-ledger" aria-labelledby="handling-title">
        <div className="public-section-heading"><p className="public-kicker">02 / Data handling</p><h2 id="handling-title">What is stored and seen.</h2></div>
        <dl>{handling.map(([term, description]) => <div key={term}><dt>{term}</dt><dd>{description}</dd></div>)}</dl>
      </section>

      <section className="security-boundary" aria-labelledby="boundary-title">
        <div><p className="public-kicker"><ShieldAlert aria-hidden="true" /> 03 / Security boundary</p><h2 id="boundary-title">What encryption does not hide.</h2></div>
        <div><p>A compromised browser or development machine can read content at that endpoint. Revoke a lost device from the local CLI.</p><p>The broker can delay, drop, or reorder traffic. Hosting and Push providers can observe network metadata, but they cannot forge a valid approval.</p><p>remotty opens an outbound WSS connection. It does not expose an inbound OpenCode port.</p></div>
      </section>
      <PublicFooter />
    </main>
  )
}
