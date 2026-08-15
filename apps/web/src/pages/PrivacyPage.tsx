import { useEffect } from "react"
import { ArrowLeft, LockKeyhole, ShieldAlert } from "lucide-react"
import { PublicBrand } from "../components/public/PublicBrand"

export function PrivacyPage() {
  useEffect(() => {
    const previous = document.title
    document.title = "Privacy | remotty"
    return () => { document.title = previous }
  }, [])

  return (
    <main className="h-dvh overflow-y-auto bg-[#090a0b] text-[#f4f2eb] selection:bg-[#d8ff3e] selection:text-[#090a0b]">
      <header className="sticky top-0 z-30 border-b border-[#292d2d] bg-[#090a0bf2]">
        <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <PublicBrand />
          <a className="inline-flex h-10 items-center gap-2 rounded-sm border border-[#3a4140] px-4 font-mono text-[10px] font-bold uppercase text-[#b5bdb9] hover:border-[#42e8d4] hover:text-[#42e8d4]" href="/"><ArrowLeft size={15} /> Home</a>
        </nav>
      </header>

      <section className="border-b border-[#2b5551] bg-[#0b1514] py-20">
        <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
          <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase text-[#42e8d4]"><LockKeyhole size={15} /> Privacy design</p>
          <h1 className="mt-5 max-w-4xl font-mono text-4xl font-bold leading-tight sm:text-6xl">Your OpenCode content stays between your devices.</h1>
          <p className="mt-7 max-w-3xl text-sm leading-7 text-[#9eb8b4]">remotty uses end-to-end encryption. The hosted broker routes ciphertext and keeps no chat history. You can verify the design in the public source.</p>
        </div>
      </section>

      <section className="border-b border-[#292d2d] bg-[#0d1011] py-16">
        <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
          <p className="font-mono text-[10px] font-bold uppercase text-[#ff635d]">How it works</p>
          <h2 className="mt-3 font-mono text-3xl font-bold sm:text-4xl">Encryption starts before the network.</h2>
          <div className="mt-10 grid border-y border-[#3a4140] md:grid-cols-3">
            <div className="border-b border-[#292d2d] py-7 md:border-b-0 md:border-r md:pr-8"><b className="font-mono text-xs text-[#ff635d]">01</b><h3 className="mt-4 font-mono text-sm font-bold">Create local keys</h3><p className="mt-4 text-xs leading-6 text-[#8d9692]">The OpenCode plugin creates relay keys. Each browser creates separate device keys during a ten-minute, one-time enrollment.</p></div>
            <div className="border-b border-[#292d2d] py-7 md:border-b-0 md:border-r md:px-8"><b className="font-mono text-xs text-[#ff635d]">02</b><h3 className="mt-4 font-mono text-sm font-bold">Encrypt and sign</h3><p className="mt-4 text-xs leading-6 text-[#8d9692]">P-256 key agreement and HKDF derive AES-256-GCM keys. Signed commands bind every action to an enrolled device.</p></div>
            <div className="py-7 md:pl-8"><b className="font-mono text-xs text-[#ff635d]">03</b><h3 className="mt-4 font-mono text-sm font-bold">Route ciphertext</h3><p className="mt-4 text-xs leading-6 text-[#8d9692]">The broker forwards encrypted frames. It cannot read sessions, tool output, questions, approvals, prompts, or notification text.</p></div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#292d2d] bg-[#090a0b] py-16">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 sm:px-8 lg:grid-cols-[.75fr_1.25fr]">
          <div><p className="font-mono text-[10px] font-bold uppercase text-[#42e8d4]">Data handling</p><h2 className="mt-3 font-mono text-3xl font-bold sm:text-4xl">What is stored and seen.</h2></div>
          <div className="border-t border-[#3a4140]">
            <div className="grid gap-2 border-b border-[#292d2d] py-5 sm:grid-cols-[180px_1fr]"><strong className="font-mono text-xs text-[#d8ff3e]">Session content</strong><p className="text-xs leading-6 text-[#8d9692]">Encrypted in transit. The broker holds frames only while it routes them and does not write chat content to storage.</p></div>
            <div className="grid gap-2 border-b border-[#292d2d] py-5 sm:grid-cols-[180px_1fr]"><strong className="font-mono text-xs text-[#d8ff3e]">Device secrets</strong><p className="text-xs leading-6 text-[#8d9692]">Relay private keys stay in the local config. Browser private keys stay in IndexedDB. One-time invite secrets expire or disappear after use.</p></div>
            <div className="grid gap-2 border-b border-[#292d2d] py-5 sm:grid-cols-[180px_1fr]"><strong className="font-mono text-xs text-[#d8ff3e]">Push notifications</strong><p className="text-xs leading-6 text-[#8d9692]">The broker and Push provider receive encrypted notification envelopes. Your service worker verifies and decrypts them on the device.</p></div>
            <div className="grid gap-2 border-b border-[#292d2d] py-5 sm:grid-cols-[180px_1fr]"><strong className="font-mono text-xs text-[#d8ff3e]">Visible metadata</strong><p className="text-xs leading-6 text-[#8d9692]">The service can see IP addresses, request times, message sizes, opaque room and device IDs, delivery timing, and Push endpoints.</p></div>
            <div className="grid gap-2 border-b border-[#292d2d] py-5 sm:grid-cols-[180px_1fr]"><strong className="font-mono text-xs text-[#d8ff3e]">Tracking</strong><p className="text-xs leading-6 text-[#8d9692]">The PWA has no account, analytics, advertising tracker, or application cookie.</p></div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#2b5551] bg-[#0b1514] py-16">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 sm:px-8 lg:grid-cols-2">
          <div><p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase text-[#ffbd4a]"><ShieldAlert size={15} /> Security boundary</p><h2 className="mt-4 font-mono text-3xl font-bold">What encryption does not hide.</h2></div>
          <div className="space-y-4 text-sm leading-7 text-[#9eb8b4]"><p>A compromised browser or development machine can read content at that endpoint. Revoke a lost device from the local CLI.</p><p>The broker can delay, drop, or reorder traffic. Hosting and Push providers can observe network metadata, but they cannot forge a valid approval.</p><p>remotty opens an outbound WSS connection. It does not expose an inbound OpenCode port.</p></div>
        </div>
      </section>

      <footer className="bg-[#090a0b] py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-8"><PublicBrand /><div className="flex flex-wrap gap-5 font-mono text-[10px] uppercase text-[#8d9692]"><a className="hover:text-[#42e8d4]" href="/pair">Pair</a><a className="hover:text-[#42e8d4]" href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer">Source</a><a className="hover:text-[#42e8d4]" href="https://github.com/d3vv3/remotty/blob/main/LICENSE" target="_blank" rel="noreferrer">AGPL-3.0</a></div></div>
      </footer>
    </main>
  )
}
