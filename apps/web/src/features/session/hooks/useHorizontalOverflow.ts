import { useLayoutEffect, useRef, useState } from "react"

export function useHorizontalOverflow(contentKey: string) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [hasOverflowRight, setHasOverflowRight] = useState(false)

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    // Allow for fractional scroll positions at the end of the row.
    const measure = () => setHasOverflowRight(element.scrollWidth - element.clientWidth - element.scrollLeft > 1)
    measure()
    element.addEventListener("scroll", measure, { passive: true })
    window.addEventListener("resize", measure)
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure)
    observer?.observe(element)
    for (const child of element.children) observer?.observe(child)
    return () => {
      element.removeEventListener("scroll", measure)
      window.removeEventListener("resize", measure)
      observer?.disconnect()
    }
  }, [contentKey])

  return { scrollRef, hasOverflowRight }
}
