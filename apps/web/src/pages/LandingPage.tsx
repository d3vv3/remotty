import { useEffect } from "react"
import { ArrowRight, Bell, Database, Github, LockKeyhole, ShieldCheck, Smartphone, Terminal, Unplug } from "lucide-react"
import { PhonePreview, PublicBrand } from "../components/public"

const publicFeatures = [
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
    try {
      anchor = decodeURIComponent(location.hash.slice(1))
    } catch {
      return
    }
    if (anchor !== "features") return
    requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView())
  }, [])

  return (
    <main className="h-dvh overflow-y-auto bg-[#090a0b] text-[#f4f2eb] selection:bg-[#d8ff3e] selection:text-[#090a0b]">
      <header className="sticky top-0 z-30 border-b border-[#292d2d] bg-[#090a0bf2]">
        <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <PublicBrand />
          <div className="flex items-center gap-2 sm:gap-4">
            <a className="hidden h-10 items-center gap-2 px-2 font-mono text-[10px] font-bold uppercase text-[#b5bdb9] hover:text-[#42e8d4] sm:inline-flex" href="/install/">Install</a>
            <a className="inline-flex h-10 items-center gap-2 px-2 font-mono text-[10px] font-bold uppercase text-[#b5bdb9] hover:text-[#42e8d4]" href="/privacy"><LockKeyhole size={14} />Privacy</a>
            <a className="hidden size-10 place-items-center rounded-sm border border-[#3a4140] text-[#8d9692] hover:border-[#42e8d4] hover:text-[#42e8d4] sm:grid" href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer" title="View remotty on GitHub"><Github size={18} /></a>
            <a className="inline-flex h-10 items-center gap-2 rounded-sm border border-[#efff91] bg-[#d8ff3e] px-4 font-mono text-xs font-bold uppercase text-[#080909] shadow-[3px_3px_0_#42e8d4] hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0_#42e8d4]" href="/pair">Pair <ArrowRight size={15} /></a>
          </div>
        </nav>
      </header>

      <section className="overflow-hidden border-b border-[#292d2d] bg-[#0c0e0f]">
        <div className="relative mx-auto min-h-[calc(100svh-96px)] w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:flex lg:min-h-[760px] lg:items-center lg:pr-[410px]">
          <div className="relative z-10 max-w-3xl text-center lg:text-left">
            <p className="mb-5 font-mono text-[10px] font-bold uppercase text-[#42e8d4]">OpenCode, away from your desk</p>
            <h1 className="m-0 font-mono text-6xl font-bold leading-none text-[#d8ff3e] [text-shadow:4px_4px_0_#42e8d4] sm:text-8xl xl:text-9xl">remotty</h1>
            <h2 className="mt-6 font-mono text-2xl font-bold leading-tight sm:text-4xl">Keep your coding agents moving from anywhere.</h2>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-[#b5bdb9] sm:text-base">Watch OpenCode work, answer questions, approve commands, inspect diffs, and send the next instruction from an installable mobile PWA.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
            <a className="inline-flex h-12 items-center gap-2 rounded-sm border border-[#efff91] bg-[#d8ff3e] px-6 font-mono text-xs font-bold uppercase text-[#080909] shadow-[4px_4px_0_#42e8d4]" href="/pair">Pair a device <ArrowRight size={16} /></a>
            <a className="inline-flex h-12 items-center gap-2 rounded-sm border border-[#3a4140] bg-[#141718] px-6 font-mono text-xs font-bold uppercase text-[#f4f2eb] hover:border-[#42e8d4] hover:text-[#42e8d4]" href="/install/"><Terminal size={16} /> Install</a>
            </div>
          </div>
          <div className="mt-12 flex justify-center lg:absolute lg:bottom-7 lg:right-16 lg:mt-0 xl:right-24"><PhonePreview /></div>
        </div>
      </section>

      <section className="border-b border-[#292d2d] bg-[#111415] py-20" id="features">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
          <p className="font-mono text-[10px] font-bold uppercase text-[#ff635d]">Full remote control surface</p>
          <h2 className="mt-3 max-w-3xl font-mono text-3xl font-bold sm:text-5xl">Everything you need to leave the desk.</h2>
          <div className="mt-10 grid gap-px overflow-hidden rounded-md border border-[#292d2d] bg-[#292d2d] sm:grid-cols-2 lg:grid-cols-3">
            {publicFeatures.map(({ icon: Icon, title, copy }) => (
              <article className="min-h-48 bg-[#0e1011] p-6" key={title}>
                <span className="grid size-10 place-items-center rounded-sm border border-[#3a4140] bg-[#171a1b] text-[#d8ff3e]"><Icon size={19} /></span>
                <h3 className="mt-7 font-mono text-sm font-bold">{title}</h3>
                <p className="mt-3 text-xs leading-6 text-[#8d9692]">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#292d2d] bg-[#090a0b] py-20">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
          <p className="font-mono text-[10px] font-bold uppercase text-[#42e8d4]">Three local steps</p>
          <h2 className="mt-3 font-mono text-3xl font-bold sm:text-5xl">Pair without an account.</h2>
          <div className="mt-10 grid border-y border-[#3a4140] md:grid-cols-3">
            <div className="border-b border-[#292d2d] py-7 md:border-b-0 md:border-r md:pr-8"><b className="font-mono text-xs text-[#ff635d]">01</b><h3 className="mt-4 font-mono text-sm font-bold">Install the plugin</h3><code className="mt-4 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[10px] text-[#42e8d4]">opencode plugin opencode-remotty --global --force</code></div>
            <div className="border-b border-[#292d2d] py-7 md:border-b-0 md:border-r md:px-8"><b className="font-mono text-xs text-[#ff635d]">02</b><h3 className="mt-4 font-mono text-sm font-bold">Create an invite</h3><code className="mt-4 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[10px] text-[#42e8d4]">npx --yes --package opencode-remotty@latest remotty pair</code></div>
            <div className="py-7 md:pl-8"><b className="font-mono text-xs text-[#ff635d]">03</b><h3 className="mt-4 font-mono text-sm font-bold">Scan and continue</h3><p className="mt-4 text-xs leading-6 text-[#8d9692]">Scan the QR code or paste the encrypted invite into the pairing page. Quit OpenCode, then run <code>opencode --continue</code>.</p></div>
          </div>
        </div>
      </section>

      <footer className="bg-[#090a0b] py-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-8"><PublicBrand /><div className="flex flex-wrap gap-5 font-mono text-[10px] uppercase text-[#8d9692]"><a className="hover:text-[#42e8d4]" href="/install/">Install</a><a className="hover:text-[#42e8d4]" href="/pair">Pair</a><a className="hover:text-[#42e8d4]" href="/privacy">Privacy</a><a className="hover:text-[#42e8d4]" href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer">Source</a><a className="hover:text-[#42e8d4]" href="https://github.com/d3vv3/remotty/blob/main/LICENSE" target="_blank" rel="noreferrer">AGPL-3.0</a></div></div>
      </footer>
    </main>
  )
}
