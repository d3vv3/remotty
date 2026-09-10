import { useLayoutEffect, useRef, type UIEvent } from "react"

const ACTIVITY_BOTTOM_THRESHOLD = 80
const isNearActivityBottom = (element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">) =>
  element.scrollHeight - element.scrollTop - element.clientHeight <= ACTIVITY_BOTTOM_THRESHOLD

export function useActivityScroll(active: boolean, contentRevision: readonly unknown[]) {
  const contentRef = useRef<HTMLDivElement>(null)
  const followOutputRef = useRef(true)
  const scrollTopRef = useRef(0)
  const restorePendingRef = useRef(false)
  const geometryRef = useRef<{ height: number; content: number } | undefined>(undefined)
  const rememberGeometry = (element: HTMLElement) => {
    geometryRef.current = { height: element.clientHeight, content: element.scrollHeight }
  }

  useLayoutEffect(() => {
    const element = contentRef.current
    if (!active || !element || typeof ResizeObserver === "undefined") return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (followOutputRef.current) element.scrollTop = element.scrollHeight
        rememberGeometry(element)
      })
    })
    observer.observe(element)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [active])

  useLayoutEffect(() => {
    if (!active) return
    const frame = requestAnimationFrame(() => {
      const element = contentRef.current
      if (!element) return
      if (followOutputRef.current) {
        element.scrollTop = element.scrollHeight
      } else if (restorePendingRef.current) {
        element.scrollTop = scrollTopRef.current
      }
      if (followOutputRef.current || restorePendingRef.current) {
        scrollTopRef.current = element.scrollTop
        followOutputRef.current = isNearActivityBottom(element)
      }
      restorePendingRef.current = false
      rememberGeometry(element)
    })
    return () => cancelAnimationFrame(frame)
  }, [active, ...contentRevision])

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!active) return
    const element = event.currentTarget
    const previous = geometryRef.current
    // Browser anchoring and viewport resizing also emit scroll events. They
    // must not turn a pinned conversation into an intentional history read.
    if (previous && (previous.height !== element.clientHeight || previous.content !== element.scrollHeight)) return
    scrollTopRef.current = element.scrollTop
    followOutputRef.current = isNearActivityBottom(element)
  }

  const beforeTabChange = (leavingActivity: boolean, enteringActivity: boolean) => {
    if (leavingActivity && contentRef.current) {
      const element = contentRef.current
      scrollTopRef.current = element.scrollTop
      followOutputRef.current = isNearActivityBottom(element)
    }
    if (enteringActivity) restorePendingRef.current = true
  }

  return { contentRef, onScroll, beforeTabChange }
}
