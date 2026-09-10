import { useEffect } from "react"
import { ArrowRight, Bell, Database, ScanLine, ShieldCheck, Smartphone, Terminal, Unplug } from "lucide-react"
import { PhonePreview, PublicFooter, PublicHeader } from "../components/public"
import "../public.css"

const capabilities = [
  { icon: Bell, title: "Actionable Push notifications", copy: "Get completion, permission, and question alerts. Approve once, always, or reject without opening the PWA." },
  { icon: ShieldCheck, title: "Approval controls", copy: "Read the requested command and its patterns before you grant access." },
  { icon: Terminal, title: "Tool details", copy: "Expand tool calls to inspect inputs, outputs, errors, and readable edit diffs." },
  { icon: Smartphone, title: "Installable PWA", copy: "Use the full mobile interface from your home screen without an app-store install." },
  { icon: Database, title: "No chat storage", copy: "The broker keeps routing state in memory and does not persist your session messages." },
  { icon: Unplug, title: "No inbound port", copy: "The local plugin opens an outbound WSS connection. You do not expose the OpenCode web server or change firewall rules." },
]

export function LandingPage() {
  useEffect(() => {
    let anchor = ""
    try { anchor = decodeURIComponent(location.hash.slice(1)) } catch { return }
    if (anchor === "features") requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView())
  }, [])

  return (
    <main className="public-page">
      <PublicHeader />
      <section className="landing-masthead">
        <div className="landing-masthead__copy">
          <p className="public-kicker">OpenCode, away from your desk <span>01 / Remote operator</span></p>
          <h1>Keep the work <em>moving.</em></h1>
          <p className="landing-masthead__lede">Watch OpenCode work, answer questions, approve commands, inspect diffs, and send the next instruction from an installable mobile PWA.</p>
          <div className="public-actions">
            <a className="public-action" href="/pair">Pair a device <ArrowRight aria-hidden="true" /></a>
            <a className="public-action public-action--secondary" href="/install/"><Terminal aria-hidden="true" /> Install</a>
          </div>
          <dl className="landing-facts"><div><dt>Connection</dt><dd>Outbound WSS</dd></div><div><dt>Account</dt><dd>Not required</dd></div><div><dt>Payload</dt><dd>End-to-end encrypted</dd></div></dl>
        </div>
        <PhonePreview />
      </section>

      <section className="public-band public-band--workflow" aria-labelledby="workflow-title">
        <div className="public-section-heading"><p className="public-kicker">02 / Pairing workflow</p><h2 id="workflow-title">Three local steps. No account.</h2></div>
        <ol className="numbered-workflow">
          <li><span>01</span><div><h3>Install the plugin</h3><code tabIndex={0} aria-label="OpenCode plugin install command">opencode plugin opencode-remotty --global --force</code></div></li>
          <li><span>02</span><div><h3>Create an invite</h3><code tabIndex={0} aria-label="remotty pairing command">npx --yes --package opencode-remotty@latest remotty pair</code></div></li>
          <li><span>03</span><div><h3>Scan and continue</h3><p>Scan the QR code or paste the encrypted invite into the pairing page. Quit OpenCode, then run <code>opencode --continue</code>.</p></div></li>
        </ol>
      </section>

      <section className="public-band" id="features" aria-labelledby="capabilities-title">
        <div className="public-section-heading"><p className="public-kicker">03 / Control surface</p><h2 id="capabilities-title">The full session, readable at a glance.</h2></div>
        <div className="capability-ledger">
          {capabilities.map(({ icon: Icon, title, copy }, index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><Icon aria-hidden="true" /><h3>{title}</h3><p>{copy}</p></article>)}
        </div>
      </section>

      <section className="public-cta"><ScanLine aria-hidden="true" /><div><p className="public-kicker">Ready at the terminal</p><h2>Connect this browser.</h2></div><a className="public-action" href="/pair">Open pairing <ArrowRight aria-hidden="true" /></a></section>
      <PublicFooter />
    </main>
  )
}
