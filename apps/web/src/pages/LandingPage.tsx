import { useEffect } from "react"
import { ArrowRight, Bell, Database, ScanLine, ShieldCheck, Smartphone, Terminal, Unplug } from "lucide-react"
import { PublicAction, PublicFooter, PublicHeader } from "../components/public"
import "../public.css"

const capabilities = [
  { icon: Bell, title: "Know when you're needed", copy: "Get completion, permission, and question alerts. Approve once, always, or reject right from a Push notification." },
  { icon: ShieldCheck, title: "Give the go-ahead", copy: "Read the requested command and its patterns before you grant access. Answer questions and send the next instruction." },
  { icon: Terminal, title: "See what changed", copy: "Follow the conversation, then expand tool calls to inspect inputs, outputs, errors, and readable edit diffs." },
  { icon: Smartphone, title: "One tap from your home screen", copy: "Install the PWA for the full mobile interface, without an app-store install." },
]

export function LandingPage() {
  useEffect(() => {
    let anchor = ""
    try { anchor = decodeURIComponent(location.hash.slice(1)) } catch { return }
    if (anchor === "features" || anchor === "get-started") requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView())
  }, [])

  return (
    <main className="public-page">
      <PublicHeader />
      <section className="landing-masthead">
        <div className="landing-masthead__copy">
          <p className="public-kicker">OpenCode, away from your desk</p>
          <h1>Your agents.<br /><em>Within reach.</em></h1>
          <p className="landing-masthead__lede">Keep the conversation going from your phone. Follow your OpenCode sessions, approve the next step, and send an idea while your computer does the work.</p>
          <div className="public-actions">
            <PublicAction href="#get-started">Get started <ArrowRight aria-hidden="true" /></PublicAction>
            <PublicAction secondary href="/pair"><ScanLine aria-hidden="true" /> Pair a device</PublicAction>
          </div>
          <p className="landing-reassurance"><ShieldCheck aria-hidden="true" /> End-to-end encrypted. No account needed.</p>
          <a className="public-text-link" href="#features">See what you can do <ArrowRight aria-hidden="true" /></a>
        </div>
        <figure className="product-preview">
          <img src="/remotty-session-720.webp" srcSet="/remotty-session-360.webp 360w, /remotty-session-720.webp 720w" sizes="(max-width: 640px) 280px, 340px" width={720} height={1476} fetchPriority="high" alt="A real Remotty session: an amber user message asks about the PWA update modal, OpenCode replies, and the composer and Activity, Todos, Changes, and Subagents tabs sit below." />
          <figcaption>A real conversation, right in your pocket.</figcaption>
        </figure>
      </section>

      <section className="public-band public-band--workflow" id="get-started" aria-labelledby="workflow-title">
        <div className="public-section-heading"><p className="public-kicker">From your desk to your phone</p><h2 id="workflow-title">Set up once.<br />Pick up anywhere.</h2></div>
        <ol className="numbered-workflow">
          <li><span>01</span><div><h3>Install the plugin</h3><code tabIndex={0} aria-label="OpenCode plugin install command">opencode plugin opencode-remotty --global --force</code></div></li>
          <li><span>02</span><div><h3>Create an invite</h3><code tabIndex={0} aria-label="remotty pairing command">npx --yes --package opencode-remotty@latest remotty pair</code></div></li>
          <li><span>03</span><div><h3>Scan and continue</h3><p>Scan the QR code or paste the encrypted invite into the pairing page. Quit OpenCode, then run <code>opencode --continue</code>.</p></div></li>
        </ol>
      </section>

      <section className="public-band" id="features" aria-labelledby="capabilities-title">
        <div className="public-section-heading"><p className="public-kicker">Stay in the conversation</p><h2 id="capabilities-title">A little attention.<br />A lot of progress.</h2></div>
        <div className="capability-list">
          {capabilities.map(({ icon: Icon, title, copy }) => <article key={title}><Icon aria-hidden="true" /><div><h3>{title}</h3><p>{copy}</p></div></article>)}
        </div>
      </section>

      <section className="public-trust" aria-labelledby="trust-title"><ShieldCheck aria-hidden="true" /><div><p className="public-kicker">Your work stays yours</p><h2 id="trust-title">Between your devices.</h2><p><Database aria-hidden="true" /> The broker keeps routing state in memory and does not persist your session messages.</p><p><Unplug aria-hidden="true" /> The plugin connects over outbound WSS. No exposed OpenCode server or firewall changes.</p><a className="public-text-link" href="/privacy">Read how privacy works <ArrowRight aria-hidden="true" /></a></div></section>
      <section className="public-cta"><div><p className="public-kicker">Have an invite ready?</p><h2>Let's take this with you.</h2></div><PublicAction href="/pair">Pair this device <ArrowRight aria-hidden="true" /></PublicAction></section>
      <PublicFooter />
    </main>
  )
}
