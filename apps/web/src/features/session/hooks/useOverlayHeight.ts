import { useLayoutEffect, useRef, useState } from "react"

/** Measure overlay chrome without reserving a row outside the scrollport. */
export function useOverlayHeight<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!enabled || !element) { setHeight(0); return }
    let active = true
    const measure = () => {
      if (!active) return
      const next = Math.ceil(element.getBoundingClientRect().height)
      setHeight((current) => current === next ? current : next)
    }
    measure()
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure)
    observer?.observe(element)
    return () => { active = false; observer?.disconnect() }
  }, [enabled])
  return { ref, height: enabled ? height : 0 }
}
