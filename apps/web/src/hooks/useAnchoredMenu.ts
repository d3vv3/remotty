import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react"

/** Keep a portalled menu above its trigger, outside scroll-container clipping. */
export function useAnchoredMenu(open: boolean, trigger: RefObject<HTMLElement | null>) {
  const [style, setStyle] = useState<CSSProperties>({})
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const viewport = window.visualViewport
      const top = viewport?.offsetTop ?? 0
      const left = viewport?.offsetLeft ?? 0
      const width = Math.min(320, (viewport?.width ?? window.innerWidth) - 24)
      setStyle({ position: "fixed", width, left: Math.max(left + 12, Math.min(rect.left, left + (viewport?.width ?? window.innerWidth) - width - 12)), top: "auto", bottom: window.innerHeight - rect.top + 6, maxHeight: Math.max(0, Math.min(420, rect.top - top - 18)) })
    }
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    window.visualViewport?.addEventListener("resize", place)
    window.visualViewport?.addEventListener("scroll", place)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
      window.visualViewport?.removeEventListener("resize", place)
      window.visualViewport?.removeEventListener("scroll", place)
    }
  }, [open, trigger])
  return style
}
