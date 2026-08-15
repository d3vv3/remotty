import { type FormEvent, useEffect, useRef, useState } from "react"
import { ChevronRight, Github, KeyRound, ScanLine, Terminal, X } from "lucide-react"
import type { PairingBundle } from "@remotty/protocol"
import { IconButton } from "../../components/ui/Button"
import { PublicBrand } from "../../components/public/PublicBrand"
import { pairingBundleFrom } from "./pairing"

export function PairingScreen({ onConnect, error }: { onConnect: (bundle: PairingBundle) => void; error?: string }) {
  const [code, setCode] = useState("")
  const [scannerOpen, setScannerOpen] = useState(false)
  const [pairingError, setPairingError] = useState<string>()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const bundle = pairingBundleFrom(code)
    if (!bundle) {
      setPairingError("Enter a valid remotty v2 encrypted invite.")
      return
    }
    onConnect(bundle)
  }
  return (
    <main className="h-dvh overflow-y-auto bg-[#090a0b] text-[#f4f2eb]">
      <header className="border-b-2 border-[#d8ff3e] bg-[#0b0d0e]">
        <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8"><PublicBrand /><div className="flex items-center gap-5"><a className="font-mono text-[10px] uppercase text-[#8d9692] hover:text-[#42e8d4]" href="/install/">Install</a><a className="font-mono text-[10px] uppercase text-[#8d9692] hover:text-[#42e8d4]" href="/privacy">Privacy</a><a className="inline-flex items-center gap-2 font-mono text-[10px] uppercase text-[#8d9692] hover:text-[#42e8d4]" href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer"><Github size={15} /> GitHub</a></div></nav>
      </header>
      <section className="mx-auto grid min-h-[calc(100svh-64px)] w-full max-w-6xl items-center gap-12 px-5 py-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(400px,.85fr)]">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase text-[#42e8d4]">Connect this browser</p>
          <h1 className="mt-4 font-mono text-4xl font-bold sm:text-6xl">Pair your device.</h1>
          <p className="mt-5 max-w-xl text-sm leading-7 text-[#b5bdb9]">Paste the invite token printed by the local CLI, or scan its QR code.</p>
          <form onSubmit={submit} className="mt-8 max-w-xl">
            <label className="mb-2 flex items-center gap-2 font-mono text-[9px] font-bold uppercase text-[#d8ff3e]" htmlFor="pairing-code"><KeyRound size={14} /> Encrypted invite</label>
            <div className="grid grid-cols-[minmax(0,1fr)_48px_48px] gap-2">
              <input className="h-12 min-w-0 rounded-sm border border-[#3a4140] bg-[#151819] px-4 font-mono text-xs text-[#f4f2eb] outline-none focus:border-[#d8ff3e] focus:ring-2 focus:ring-[#d8ff3e26]" id="pairing-code" value={code} onChange={(event) => { setCode(event.target.value); setPairingError(undefined) }} placeholder="Paste v2 encrypted invite" autoCapitalize="none" autoComplete="one-time-code" maxLength={4096} autoFocus />
              <button type="button" className="grid size-12 place-items-center rounded-sm border border-[#42e8d4] bg-[#071817] text-[#42e8d4] hover:bg-[#42e8d4] hover:text-[#071817]" title="Scan pairing QR code" aria-label="Scan pairing QR code" onClick={() => setScannerOpen(true)}><ScanLine size={20} /></button>
              <button type="submit" className="grid size-12 place-items-center rounded-sm border border-[#efff91] bg-[#d8ff3e] text-[#080909] shadow-[3px_3px_0_#42e8d4]" aria-label="Connect remotty"><ChevronRight size={20} /></button>
            </div>
            {(pairingError ?? error) && <p className="mt-3 font-mono text-[10px] text-[#ff635d]">{pairingError ?? error}</p>}
          </form>
        </div>
        <div className="border-y border-[#3a4140] bg-[#0c0f10]">
          <div className="flex h-12 items-center gap-2 border-b border-[#292d2d] px-4 font-mono text-[10px] font-bold uppercase text-[#d8ff3e]"><Terminal size={18} /> Install and pair</div>
          <div className="grid min-h-28 grid-cols-[44px_1fr] gap-3 border-b border-[#292d2d] p-4"><b className="font-mono text-[10px] text-[#ff635d]">01</b><div><strong className="text-xs">Add the OpenCode plugin</strong><code className="mt-3 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[9px] text-[#42e8d4]">opencode plugin opencode-remotty --global --force</code></div></div>
          <div className="grid min-h-28 grid-cols-[44px_1fr] gap-3 border-b border-[#292d2d] p-4"><b className="font-mono text-[10px] text-[#ff635d]">02</b><div><strong className="text-xs">Create an encrypted device invite</strong><code className="mt-3 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[9px] text-[#42e8d4]">npx --yes --package opencode-remotty@latest remotty pair</code></div></div>
          <div className="grid min-h-28 grid-cols-[44px_1fr] gap-3 p-4"><b className="font-mono text-[10px] text-[#ff635d]">03</b><div><strong className="text-xs">Restart OpenCode</strong><p className="mt-2 text-xs text-[#8d9692]">Quit the running OpenCode process, then run:</p><code className="mt-3 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[9px] text-[#42e8d4]">opencode --continue</code></div></div>
        </div>
      </section>
      {scannerOpen && <PairingScanner onClose={() => setScannerOpen(false)} onScan={(bundle) => { setScannerOpen(false); onConnect(bundle) }} />}
    </main>
  )
}

type BarcodeDetectorLike = new (options?: { formats?: string[] }) => {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>
}

export function PairingScanner({ onScan, onClose }: { onScan: (bundle: PairingBundle) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    const cleanups: Array<() => void> = []
    const stopAll = () => {
      for (const cleanup of cleanups.splice(0)) cleanup()
    }
    const finish = (text: string) => {
      if (cancelled) return
      const bundle = pairingBundleFrom(text)
      if (!bundle) {
        setError("This QR code does not contain a remotty v2 encrypted invite.")
        return
      }
      cancelled = true
      stopAll()
      onScan(bundle)
    }

    const scanWithZxing = async (stream: MediaStream, video: HTMLVideoElement) => {
      const [{ BrowserQRCodeReader }, { DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ])
      if (cancelled) return
      const hints = new Map([[DecodeHintType.TRY_HARDER, true]])
      const reader = new BrowserQRCodeReader(hints, { delayBetweenScanAttempts: 50 })
      const controls = await reader.decodeFromStream(stream, video, (result) => {
        if (result) finish(result.getText())
      })
      if (cancelled) controls.stop()
      else cleanups.push(() => controls.stop())
    }

    const scanWithDetector = (video: HTMLVideoElement, Detector: BarcodeDetectorLike, onBroken: () => void) => {
      const detector = new Detector({ formats: ["qr_code"] })
      let fellBack = false
      const timer = window.setInterval(() => {
        if (video.readyState < 2) return
        detector.detect(video).then((codes) => {
          const value = codes.find((code) => code.rawValue)?.rawValue
          if (value) finish(value)
        }).catch(() => {
          if (fellBack) return
          fellBack = true
          window.clearInterval(timer)
          onBroken()
        })
      }, 100)
      cleanups.push(() => window.clearInterval(timer))
    }

    const start = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      cleanups.push(() => {
        for (const track of stream.getTracks()) track.stop()
      })
      if (cancelled) {
        stopAll()
        return
      }
      const [track] = stream.getVideoTracks()
      await track?.applyConstraints({ advanced: [{ focusMode: "continuous" }] } as unknown as MediaTrackConstraints).catch(() => undefined)
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play().catch(() => undefined)
      if (cancelled) return
      const Detector = (window as { BarcodeDetector?: BarcodeDetectorLike }).BarcodeDetector
      if (Detector) {
        try {
          scanWithDetector(video, Detector, () => {
            void scanWithZxing(stream, video).catch(() => setError("The QR scanner failed to start."))
          })
          return
        } catch {
          // fall through to zxing
        }
      }
      await scanWithZxing(stream, video)
    }

    void start().catch(() => setError("Camera access is unavailable. Check the browser permission."))

    return () => {
      cancelled = true
      stopAll()
    }
  }, [onScan])

  return (
    <div className="scanner-overlay" role="dialog" aria-modal="true" aria-label="Scan pairing QR code">
      <section className="scanner-panel">
        <header><span><ScanLine size={18} /> Scan pairing QR</span><IconButton aria-label="Close scanner" icon={<X size={19} />} onClick={onClose} /></header>
        <div className="scanner-view"><video ref={videoRef} muted playsInline /><span className="scanner-frame" /></div>
        {error && <p className="form-error">{error}</p>}
      </section>
    </div>
  )
}
