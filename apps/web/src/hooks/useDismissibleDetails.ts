import { useEffect, useRef } from "react"

export function useDismissibleDetails() {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      const details = ref.current
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false
    }
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !ref.current?.open) return
      ref.current.open = false
      ref.current.querySelector("summary")?.focus()
    }
    document.addEventListener("pointerdown", dismissOutside)
    document.addEventListener("keydown", dismissWithKeyboard)
    return () => {
      document.removeEventListener("pointerdown", dismissOutside)
      document.removeEventListener("keydown", dismissWithKeyboard)
    }
  }, [])
  return ref
}
