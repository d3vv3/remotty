import { useContext, useEffect, useRef, useState } from "react"
import { attachmentDescriptorSchema, imageMimeSchema, validateImage, validateImageDimensions, type AttachmentAddress, type AttachmentDescriptor } from "@remotty/protocol"
import { AttachmentContext } from "../AttachmentProvider"
import { classifyImageSource, fetchImage, inlineImage } from "../imageSource"

export function useImagePreview(source: string, mime: string | undefined, address: AttachmentAddress | undefined, descriptor: AttachmentDescriptor | undefined) {
  const reader = useContext(AttachmentContext)
  const ref = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [consented, setConsented] = useState(false)
  const [state, setState] = useState<{ url?: string; error?: string; loading?: boolean }>({})
  const classified = mime !== undefined && !imageMimeSchema.safeParse(mime).success
    ? { kind: "blocked" as const, reason: "Unsupported attachment type. Image previews support PNG, JPEG, WebP, GIF and AVIF." }
    : classifyImageSource(source, location.origin)
  const reference = Boolean(descriptor)
  const key = JSON.stringify([source, mime, address, descriptor])
  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect() } })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible || !reference && classified.kind === "external" && !consented) return
    const controller = new AbortController()
    const timeout = descriptor ? undefined : window.setTimeout(() => controller.abort(), 20_000)
    let active = true
    let objectUrl: string | undefined
    setState({ loading: true })
    void (async () => {
      let image
      if (descriptor) {
        attachmentDescriptorSchema.parse(descriptor)
        if (!reader || !address || address.attachmentId !== descriptor.id || source !== `remotty-attachment:${descriptor.id}`) throw new Error("Invalid attachment reference")
        const bytes = await reader(address, descriptor, controller.signal)
        image = { bytes, mime: validateImage(bytes, descriptor.mime) }
      } else if (classified.kind === "inline") image = inlineImage(classified.url, mime)
      else if (classified.kind === "blocked") throw new Error(classified.reason)
      else image = await fetchImage(classified, controller.signal)
      if (mime !== undefined && image.mime !== mime) throw new Error("Image content does not match its attachment MIME type")
      if (!active) return
      const blob = new Blob([image.bytes], { type: image.mime })
      const bitmap = await createImageBitmap(blob)
      try { validateImageDimensions(bitmap.width, bitmap.height) } finally { bitmap.close() }
      if (!active) return
      objectUrl = URL.createObjectURL(blob)
      setState({ url: objectUrl })
    })().catch((error: unknown) => { if (active) setState({ error: error instanceof Error ? error.message : "Image could not be decoded" }) })
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [key, reader, visible, consented, attempt])
  return { ref, ...state, source: classified, needsConsent: !reference && classified.kind === "external" && !consented, load: () => { setVisible(true); setConsented(true); setAttempt((value) => value + 1) } }
}
