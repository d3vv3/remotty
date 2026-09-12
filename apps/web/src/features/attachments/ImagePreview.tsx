import { useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { AttachmentAddress, AttachmentDescriptor } from "@remotty/protocol"
import { Button, Dialog, Notice } from "../../components/ui"
import { useImagePreview } from "./hooks/useImagePreview"
import "./images.css"

type ImagePreviewProps = { source: string; alt?: string; mime?: string; address?: AttachmentAddress; descriptor?: AttachmentDescriptor }
export function ImagePreview(props: ImagePreviewProps) {
  return <ImagePreviewContent key={JSON.stringify([props.source, props.mime, props.address, props.descriptor])} {...props} />
}
function ImagePreviewContent({ source, alt = "Image attachment", mime, address, descriptor }: ImagePreviewProps) {
  const preview = useImagePreview(source, mime, address, descriptor)
  const [expanded, setExpanded] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const title = useId()
  return <span className="image-preview" ref={preview.ref}>
    {preview.url ? <button ref={trigger} className="image-preview-button" onClick={() => setExpanded(true)} aria-label={`Expand ${alt}`}><img src={preview.url} alt={alt} loading="lazy" /></button>
      : <span className="image-placeholder">
        <strong>{alt}</strong>
        {preview.needsConsent && preview.source.kind === "external" ? <><span>Loading contacts {preview.source.host}. Up to 5 MiB; cookies and referrer are omitted.</span><Button onClick={preview.load}>Load image</Button></>
          : preview.loading ? <span role="status">Loading image...</span>
          : preview.error ? <><Notice as="span">{preview.error}</Notice>{(descriptor || preview.source.kind !== "blocked") && <Button onClick={preview.load}>Retry image</Button>}</>
          : <Button onClick={preview.load}>Load image</Button>}
        {preview.error && preview.source.kind === "external" && <a href={preview.source.url} target="_blank" rel="noreferrer noopener">Open image on {preview.source.host}</a>}
      </span>}
    {expanded && preview.url && createPortal(<Dialog labelledBy={title} onClose={() => setExpanded(false)} restoreFocusRef={trigger} className="connection-dialog image-dialog"><header><h2 id={title}>{alt}</h2><Button onClick={() => setExpanded(false)}>Close image</Button></header><img src={preview.url} alt={alt} /></Dialog>, document.body)}
  </span>
}
