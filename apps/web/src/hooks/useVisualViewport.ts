import { useEffect, useState, type CSSProperties } from "react"

/** Keep the conversation dock inside the visible area when a mobile keyboard opens. */
export function useVisualViewport(): CSSProperties {
  const [viewport, setViewport] = useState<{ height: number; top: number }>()
  useEffect(() => {
    const visual = window.visualViewport
    if (!visual) return
    const update = () => {
      // Let pinch zoom retain normal browser panning rather than resizing the app.
      if (visual.scale !== 1) return
      setViewport({ height: visual.height, top: visual.offsetTop })
    }
    update()
    visual.addEventListener("resize", update)
    visual.addEventListener("scroll", update)
    return () => {
      visual.removeEventListener("resize", update)
      visual.removeEventListener("scroll", update)
    }
  }, [])
  return viewport ? { "--viewport-height": `${viewport.height}px`, "--viewport-top": `${viewport.top}px` } as CSSProperties : {}
}
