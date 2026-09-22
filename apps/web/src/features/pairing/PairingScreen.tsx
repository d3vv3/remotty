import { type FormEvent, useEffect, useRef, useState } from "react"
import { ArrowRight, KeyRound, ScanLine, Terminal, X } from "lucide-react"
import type { PairingBundle } from "@remotty/protocol"
import { Button, IconButton } from "../../components/ui/Button"
import { Field } from "../../components/ui/Field"
import { PublicFooter, PublicHeader } from "../../components/public"
import { pairingBundleFrom } from "./pairing"
import { useDialogFocus } from "../../hooks"
import "../../public.css"

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
    <main className="public-page pairing-page">
      <PublicHeader active="pair" />
      <section className="pairing-layout">
        <div className="pairing-intro">
          <p className="public-kicker">Bring your session with you</p>
          <h1>Make the <em>connection.</em></h1>
          <p>Paste the invite from your computer, or scan its QR code. Your encrypted invite is valid for ten minutes.</p>
          <form onSubmit={submit} className="pairing-form">
            <Field id="pairing-code" label={<><KeyRound aria-hidden="true" /> Encrypted invite</>} error={pairingError ?? error}>
              {(controlProps) => <div className="pairing-form__controls">
                <input {...controlProps} id="pairing-code" value={code} onChange={(event) => { setCode(event.target.value); setPairingError(undefined) }} placeholder="Paste v2 encrypted invite" autoCapitalize="none" autoComplete="one-time-code" maxLength={4096} autoFocus />
                <IconButton className="pairing-scan" aria-label="Scan pairing QR code" icon={<ScanLine />} onClick={() => setScannerOpen(true)} />
                <Button className="pairing-connect" type="submit" variant="primary" aria-label="Connect remotty" endIcon={<ArrowRight />}>Connect</Button>
              </div>}
            </Field>
          </form>
          <p className="pairing-help">Your keys stay on your devices. <a href="/privacy">How pairing stays private</a></p>
        </div>
        <aside className="pairing-runbook" aria-labelledby="runbook-title">
          <h2 id="runbook-title"><Terminal aria-hidden="true" /> Install and pair</h2>
          <ol><li><span>01</span><div><strong>Add the OpenCode plugin</strong><code tabIndex={0} aria-label="OpenCode plugin install command">opencode plugin add opencode-remotty</code></div></li><li><span>02</span><div><strong>Create an encrypted device invite</strong><code tabIndex={0} aria-label="remotty pairing command">npx --yes --package opencode-remotty@latest remotty pair</code></div></li><li><span>03</span><div><strong>Restart OpenCode</strong><p>Quit the running OpenCode process, then run:</p><code tabIndex={0} aria-label="OpenCode restart command">opencode --continue</code></div></li></ol>
        </aside>
      </section>
      <PublicFooter />
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
  const dialogRef = useDialogFocus({ onClose })

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
      <section className="scanner-panel" ref={dialogRef}>
        <header><span><ScanLine size={18} /> Scan pairing QR</span><IconButton autoFocus aria-label="Close scanner" icon={<X size={19} />} onClick={onClose} /></header>
        <div className="scanner-view"><video ref={videoRef} muted playsInline /><span className="scanner-frame" /></div>
        {error && <p className="form-error">{error}</p>}
      </section>
    </div>
  )
}
